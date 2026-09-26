import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { publicOrigin } from "@/lib/app-origin";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { getT } from "@/i18n/server";
import {
  fetchPromptContent,
  locateVisible,
  PromptNotFound,
  renderPrompt,
  type FetchOptions,
  type PromptContent,
  type RenderOptions,
} from "@/lib/prompt-export";
import { placementFor, savePromptPage, savePromptToDrive } from "@/lib/prompt-export/deliver";
import { sanitizeFilename } from "@/lib/prompt-export/render";

export const dynamic = "force-dynamic";

/**
 * A page (or database, or block) as an AI-ready prompt — notion2prompt over HTTP.
 *
 *   GET  /api/pages/<id>/prompt?template=claude-xml|default|markdown&depth=5&limit=1000
 *        &childPages=true&separate=true&databases=false&properties=auto|true|false
 *        &instruction=…&layout=ainmem|notion2prompt&format=text|json&download=1&stage=fetch
 *
 *   format=text (default) is the prompt itself, text/plain — the pipe; download=1 makes
 *   it a file. format=json adds files, source tree, counts and what was left out
 *   (&includeContent=1: the content tree too). stage=fetch returns the content tree
 *   alone (notion2prompt's fetch_content).
 *
 *   POST the same options as JSON. With `content` (a stage=fetch result) it only renders
 *   — render_content, no database read, so one fetch can be rendered many ways. With
 *   `output: ["page", "drive"]` it also saves the prompt as an ainmem page and as
 *   prompts/<title>.md in your aindrive — the page only where it reaches nobody the
 *   sources do not (deliver.ts placementFor; otherwise json says
 *   `page: { saved: false, reason: "wider-than-sources" }`).
 *
 * Read as the signed-in person: what they may not see is left out (and listed in json).
 * A page they cannot see is 404, the same as one that does not exist.
 *
 * Page links: the configured public origin (APP_ORIGIN). Without one, a prompt only
 * returned to the caller links to the origin this request came in on; a prompt that is
 * also saved (output page / drive) — text other people may read — keeps relative links.
 */

type Opts = Record<string, unknown>;

const bool = (v: unknown): boolean | undefined =>
  v === true || v === "true" || v === "1" || v === "yes" ? true : v === false || v === "false" || v === "0" || v === "no" ? false : undefined;
const int = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

function readOptions(o: Opts): { fetch: Partial<FetchOptions>; render: Partial<RenderOptions> } {
  const fetch: Partial<FetchOptions> = {};
  const render: Partial<RenderOptions> = {};
  const depth = int(o.depth);
  if (depth !== undefined) fetch.depth = depth;
  const limit = int(o.limit);
  if (limit !== undefined) fetch.limit = limit;
  const child = bool(o.childPages ?? o.child_pages);
  if (child !== undefined) fetch.childPages = child;
  const dbs = bool(o.databases ?? o.alwaysFetchDatabases ?? o.always_fetch_databases);
  if (dbs !== undefined) fetch.alwaysFetchDatabases = dbs;
  const tpl = o.template;
  if (tpl === "claude-xml" || tpl === "default" || tpl === "markdown") render.template = tpl;
  const sep = bool(o.separate ?? o.separateChildPages ?? o.separate_child_page);
  if (sep !== undefined) render.separateChildPages = sep;
  const props = o.properties ?? o.includeProperties ?? o.include_properties;
  if (props === "auto") render.includeProperties = "auto";
  else if (bool(props) !== undefined) render.includeProperties = bool(props);
  if (typeof o.instruction === "string") render.instruction = o.instruction.slice(0, 20_000);
  if (o.layout === "ainmem" || o.layout === "notion2prompt") render.layout = o.layout;
  return { fetch, render };
}

function isContent(v: unknown): v is PromptContent {
  const c = v as PromptContent;
  return !!c && c.version === 1 && !!c.root && typeof c.pages === "object" && typeof c.databases === "object" && !!c.tree && !!c.location;
}

function respond(content: PromptContent, render: Partial<RenderOptions>, o: Opts, extra: Record<string, unknown> = {}) {
  const out = renderPrompt(content, render);
  if (o.format === "json")
    return NextResponse.json({
      prompt: out.prompt,
      files: out.files,
      sourceTree: out.sourceTree,
      projectPath: out.projectPath,
      chars: out.chars,
      estimatedTokens: out.estimatedTokens,
      stats: content.stats,
      skipped: content.skipped,
      options: { ...content.options, ...render },
      ...(bool(o.includeContent) ? { content } : {}),
      ...extra,
    });
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8" };
  if (bool(o.download)) {
    const name = sanitizeFilename(content.tree.title || "prompt");
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.prompt.${render.template === "markdown" ? "md" : "txt"}`)}`;
  }
  return new NextResponse(out.prompt, { headers });
}

async function handle(req: NextRequest, pageId: string, o: Opts) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const viewer = auth.user.id;
  const language = auth.user.language;
  const { fetch, render } = readOptions(o);
  if (isContent(o.content)) return respond(o.content, render, o);

  const outputs = Array.isArray(o.output) ? o.output : typeof o.output === "string" ? [o.output] : [];
  const saving = req.method === "POST" && outputs.length > 0;
  const readers = { viewerIds: [viewer], baseUrl: publicOrigin() || (saving ? "" : req.nextUrl.origin) };
  const target = await locateVisible(pageId, readers);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let content: PromptContent;
  try {
    content = await fetchPromptContent(target, fetch, readers);
  } catch (e) {
    if (e instanceof PromptNotFound) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
  if (o.stage === "fetch") return NextResponse.json(content);

  const extra: Record<string, unknown> = {};
  if (saving) {
    const t = await getT(language);
    const out = renderPrompt(content, render);
    const title = t("AI prompt — {title}", { title: content.tree.title || target.title });
    const placement = await placementFor(content, [viewer], (await getDefaultWorkspaceId(viewer)) ?? "");
    // a page the workspace's owners and admins would open, holding something they may not
    // (a participant-only doc, another workspace's page): not saved — the prompt is still returned
    if (outputs.includes("page") && placement.workspaceId && placement.blocked) extra.page = { saved: false, reason: "wider-than-sources" };
    else if (outputs.includes("page") && placement.workspaceId)
      extra.pageId = await savePromptPage({
        placement,
        askerId: viewer,
        viewerIds: [viewer],
        title,
        summary: t("Made from 「{title}」: {pages} pages · {blocks} blocks · {databases} databases · about {tokens} tokens. Copy the code block below into any AI chat.", {
          title: content.tree.title || target.title,
          pages: content.stats.pages,
          blocks: content.stats.blocks,
          databases: content.stats.databases,
          tokens: out.estimatedTokens,
        }),
        prompt: out.prompt,
        template: render.template ?? "claude-xml",
      });
    if (outputs.includes("drive")) extra.drive = await savePromptToDrive(viewer, title, out.prompt, [viewer]);
  }
  return respond(content, render, o, extra);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return handle(req, pageId, Object.fromEntries(req.nextUrl.searchParams));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const body = (await req.json().catch(() => ({}))) as Opts;
  return handle(req, pageId, body && typeof body === "object" ? body : {});
}
