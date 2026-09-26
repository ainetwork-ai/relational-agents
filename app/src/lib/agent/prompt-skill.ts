import "server-only";
import { aiChat } from "@/lib/ai";
import { publicOrigin } from "@/lib/app-origin";
import { makeT } from "@/i18n/translate";
import {
  fetchPromptContent,
  findRefInText,
  locateVisible,
  parsePromptRequest,
  PromptNotFound,
  renderPrompt,
  resolveByTitle,
  visibleTitles,
  type Candidate,
} from "@/lib/prompt-export";
import { placementFor, savePromptPage, savePromptToDrive } from "@/lib/prompt-export/deliver";
import type { Located } from "@/lib/prompt-export/collect";
import type { SkillContext, SkillResult } from "./family-skills";

/**
 * "@agent make a prompt from the Chuseok page" — notion2prompt for the family agent.
 *
 * The prompt is built by code (src/lib/prompt-export), never by the model: the local
 * model has an 8k context and the prompt must be the page, not a retelling of it. The
 * model is asked one thing at most — which of the page titles everyone here can see a
 * request means, when no title matched by name.
 *
 * Read for the people who will read the answer (the asker alone for a quiet question,
 * everyone in the room otherwise); what they cannot all see is left out and counted.
 * The prompt lands in an ainmem page (a code block) placed where exactly those people
 * see it, and in the asker's own aindrive as prompts/<title>.md when they linked one.
 */

type Target = Located & { title: string };

/** The model picks a title from the list, or none. Temperature 0, a few tokens. */
async function pickTitle(request: string, titles: Candidate[]): Promise<Candidate | null> {
  if (process.env.AGENT_FAKE_LLM === "1" || !titles.length) return null;
  const list = titles.map((c, i) => `${i + 1}. ${c.title}`).join("\n");
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          'You match a request to ONE page title from a numbered list. Output JSON only: {"index": <the number>} — or {"index": 0} when no title fits.',
      },
      { role: "user", content: `Request: ${request.slice(0, 500)}\n\nTitles:\n${list}` },
    ],
    { maxTokens: 30, temperature: 0 }
  ).catch(() => "");
  const m = raw.match(/"index"\s*:\s*(\d+)/);
  const i = m ? Number(m[1]) : 0;
  return i >= 1 && i <= titles.length ? titles[i - 1] : null;
}

export async function promptSkill(ctx: SkillContext): Promise<SkillResult> {
  const t = makeT(ctx.lang);
  const readers = ctx.viewerIds?.length ? [...new Set([ctx.askerId, ...ctx.viewerIds])] : [ctx.askerId];
  const base = { viewerIds: readers, baseUrl: publicOrigin() };
  const scope = { ...base, workspaceIds: [ctx.workspaceId] };
  const req = parsePromptRequest(ctx.text);
  const notFound = t("I couldn't open that page for everyone who will read this. Check the name or link — or ask me quietly for a copy only you can see.");
  const whichPage = t("Which page should I turn into a prompt? Say its name, paste its link, or ask from the agent panel while the page is open.");

  // ── which page ──
  let target: Target | null = null;
  const explicit = findRefInText(ctx.text);
  if (explicit) {
    target = await locateVisible(explicit, base);
    if (!target) return { text: notFound };
  } else if (req.thisPage || !req.rest) {
    if (ctx.contextPageId) target = await locateVisible(ctx.contextPageId, base);
    if (!target) return { text: whichPage };
  } else {
    const r = await resolveByTitle(req.rest, scope);
    if ("found" in r) target = r.found;
    else if ("ambiguous" in r) {
      const list = r.ambiguous.map((c) => `「${c.title}」`).join(", ");
      return { text: r.ambiguous.length > 1 ? t("Which one? {list}", { list }) : t("Did you mean {list}? Say it again with that name, or paste the page's link.", { list }) };
    }
    else {
      const picked = await pickTitle(ctx.text, await visibleTitles(scope, 60));
      if (picked) target = await locateVisible(picked.id, base);
      if (!target) return { text: t("I couldn't find a page by that name that everyone here can see.") + " " + whichPage };
    }
  }

  // ── fetch, then render ──
  const content = await fetchPromptContent(target, req.fetch, base).catch((e) => {
    if (e instanceof PromptNotFound) return null;
    throw e;
  });
  if (!content) return { text: notFound };
  const out = renderPrompt(content, req.render);
  const template = req.render.template ?? "claude-xml";
  const name = content.tree.title || target.title;
  const s = content.stats;
  const numbers = {
    pages: s.pages,
    blocks: s.blocks,
    databases: s.databases,
    rows: s.rows,
    files: out.files.length,
    chars: out.chars.toLocaleString(ctx.lang === "ko" ? "ko-KR" : "en-US"),
    tokens: out.estimatedTokens.toLocaleString(ctx.lang === "ko" ? "ko-KR" : "en-US"),
  };

  // ── where it goes ──
  const placement = await placementFor(content, readers, ctx.workspaceId);
  const title = t("AI prompt — {title}", { title: name });
  const pageId = await savePromptPage({
    placement,
    askerId: ctx.askerId,
    viewerIds: readers,
    title,
    summary: t("Made from 「{title}」: {pages} pages · {blocks} blocks · {databases} databases · about {tokens} tokens. Copy the code block below into any AI chat.", {
      ...numbers,
      title: name,
    }),
    prompt: out.prompt,
    template,
  });
  // only into a folder nobody outside these readers can open
  const drive = await savePromptToDrive(ctx.askerId, title, out.prompt, readers);

  // ── the answer ──
  const hidden = content.skipped.filter((x) => x.reason === "permission").length;
  const lines = [
    t("Made an AI prompt from 「{title}」 → /p/{pageId}", { title: name, pageId }),
    t("{pages} pages · {blocks} blocks · {databases} databases ({rows} rows) · {files} files · {chars} characters (about {tokens} tokens)", numbers),
    t("Template {template} · depth {depth} · child pages {child} · {layout}", {
      template,
      depth: content.options.depth,
      child: content.options.childPages ? t("included") : t("left out"),
      layout: (req.render.separateChildPages ?? true) ? t("one file per page") : t("merged into one file"),
    }),
  ];
  if (hidden)
    lines.push(
      readers.length > 1
        ? t("⚠️ Left out {n} linked pages or databases that not everyone here can open.", { n: hidden })
        : t("⚠️ Left out {n} linked pages or databases you can't open.", { n: hidden })
    );
  if (s.depthLimited) lines.push(t("⚠️ Stopped at depth {depth} — ask with a bigger depth (up to 50) to go further.", { depth: content.options.depth }));
  if (s.limitReached) lines.push(t("⚠️ Hit the {limit}-item limit, so the end is cut off — ask with a bigger limit.", { limit: content.options.limit }));
  if (placement.restricted) lines.push(t("🔒 The prompt page is shared only with the people who will read this answer."));
  if (drive.saved) lines.push(t("💾 Also saved to your aindrive: {path}", { path: drive.path }));
  else if (drive.reason === "shared-folder") lines.push(t("Not saved to your aindrive: that folder is shared with more people than this prompt is for."));
  else if (drive.reason === "failed") lines.push(t("Couldn't save to your aindrive: {error}", { error: drive.error ?? "" }));
  return { pageId, text: lines.join("\n") };
}
