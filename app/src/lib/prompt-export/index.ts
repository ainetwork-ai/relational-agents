import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { blocks, databases, pages, teamspaces, workspaceMembers } from "@/lib/db/schema";
import { publicOrigin } from "@/lib/app-origin";
import { collect, type Located } from "./collect";
import { coversAsked, expandAliases, idOf, isPromptPageTitle, norm, parseRef, scoreTitle, titleCoverage } from "./input";
import type { FetchOptions, PromptContent, RenderedPrompt, RenderOptions } from "./model";
import { renderPrompt } from "./render";
import { createDbSource, TEAMSPACE_PREFIX, type DbSource } from "./source-db";

/**
 * ainmem's notion2prompt, server side. Two stages, as notion2prompt's library:
 *
 *   const content = await fetchPromptContent(target, { depth: 2 }, { viewerIds })  // fetch_content
 *   const out = renderPrompt(content, { template: "claude-xml", instruction })      // render_content
 *
 * renderPrompt is pure and can run again on the same content with other options.
 * Reading is always on behalf of READERS (viewerIds): everything they may not all
 * see is left out and reported in content.skipped (ids only).
 */

export { renderPrompt } from "./render";
export { parsePromptRequest, parseRef, findRefInText, idOf, isPromptPageTitle, promptAsk } from "./input";
export { PromptNotFound, fetchOptions } from "./collect";
export type { PromptContent, RenderedPrompt, RenderOptions, FetchOptions } from "./model";

export interface Readers {
  viewerIds: string[];
  /** origin for page links; defaults to publicOrigin() (APP_ORIGIN, else relative links) */
  baseUrl?: string;
  /** read only in these workspaces — by id, by title, and everything the prompt reaches
   *  from there (a room agent's token: its room's workspace). Unset: wherever the readers see. */
  onlyWorkspaces?: string[];
}

const sourceFor = (r: Readers): DbSource =>
  createDbSource({ viewerIds: r.viewerIds, baseUrl: r.baseUrl ?? publicOrigin(), workspaceIds: r.onlyWorkspaces });

/** fetch_content: the content tree for `target`, as the readers may see it. */
export async function fetchPromptContent(target: Located, options: Partial<FetchOptions>, readers: Readers): Promise<PromptContent> {
  return collect(target, options, sourceFor(readers));
}

/** fetch + render in one go (fetch_and_render). */
export async function buildPrompt(
  target: Located,
  options: Partial<FetchOptions> & Partial<RenderOptions>,
  readers: Readers
): Promise<{ content: PromptContent; rendered: RenderedPrompt }> {
  const content = await fetchPromptContent(target, options, readers);
  return { content, rendered: renderPrompt(content, options) };
}

export interface Candidate {
  kind: "page" | "database";
  id: string;
  title: string;
}

export type Resolved =
  | { found: Located & { title: string } }
  | { ambiguous: Candidate[] }
  | { none: true };

/** An id → what it is, when every reader can see it. */
async function locateId(id: string, src: DbSource): Promise<(Located & { title: string }) | null> {
  const loc = await src.locate(id);
  if (!loc) return null;
  const visible =
    loc.kind === "block"
      ? await src.block(loc.id).then((b) => (b ? src.canSee("page", b.pageId) : false))
      : await src.canSee(loc.kind === "database" ? "database" : "page", loc.id);
  if (!visible) return null;
  const title = loc.kind === "block" ? `Block ${loc.id}` : ((await src.title(loc.kind === "database" ? "database" : "page", loc.id)) ?? "");
  return { ...loc, title };
}

/** An id, a link, or a title → what to export, among what every reader can see. */
export async function resolveTarget(
  input: string,
  readers: Readers & { workspaceIds: string[] }
): Promise<Resolved> {
  const src = sourceFor(readers);
  const ref = parseRef(input);
  const id = idOf(input);
  if (id) {
    const found = await locateId(id, src);
    if (found) return { found };
    // a uuid / link that is not there (or not for these readers) is not a title either
    if (ref.kind === "id" || id.startsWith(TEAMSPACE_PREFIX)) return { none: true };
  }
  // a bare OKF id that locates nothing may still be a one-word title
  return resolveByTitle(ref.kind === "title" ? ref.query : input, readers, src);
}

/** Every page, database and teamspace in the workspaces whose title the query names,
 *  best first, visible to every reader. */
export async function resolveByTitle(query: string, readers: Readers & { workspaceIds: string[] }, src = sourceFor(readers)): Promise<Resolved> {
  if (!query.trim() || !readers.workspaceIds.length) return { none: true };
  const ws = readers.workspaceIds;
  const expanded = expandAliases(query);
  const scored: (Candidate & { score: number })[] = [];
  const consider = (kind: Candidate["kind"], id: string, title: string) => {
    const score = scoreTitle(title, expanded);
    if (score > 0) scored.push({ kind, id, title, score });
  };
  for (const p of await db
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(and(inArray(pages.workspaceId, ws), eq(pages.isArchived, false))))
    // a prompt page the agent saved is output — "the Chuseok page" never means it
    if (!isPromptPageTitle(p.title)) consider("page", p.id, p.title);
  for (const d of await db.select({ id: databases.id, title: databases.title }).from(databases).where(inArray(databases.workspaceId, ws)))
    consider("database", d.id, d.title);
  for (const t of await db.select({ id: teamspaces.id, name: teamspaces.name }).from(teamspaces).where(inArray(teamspaces.workspaceId, ws)))
    consider("page", `${TEAMSPACE_PREFIX}${t.id}`, t.name);
  scored.sort((a, b) => b.score - a.score);
  // the best score among what every reader can see (hidden ones are passed over unseen)
  const visible: typeof scored = [];
  for (const c of scored) {
    if (visible.length && c.score < visible[0].score) break;
    if (await src.canSee(c.kind, c.id)) visible.push(c);
  }
  if (!visible.length) return { none: true };
  // a database and the page that is nothing but that database are one thing; so are a
  // teamspace and a page of the same name (the page is the more specific)
  const pageIds = new Set(visible.filter((c) => c.kind === "page").map((c) => c.id));
  const pageTitles = new Set(visible.filter((c) => c.kind === "page" && !c.id.startsWith(TEAMSPACE_PREFIX)).map((c) => norm(c.title)));
  const top: Candidate[] = [];
  for (const c of visible) {
    if (c.kind === "database" && (await src.homesOf(c.id)).some((h) => pageIds.has(h))) continue;
    if (c.id.startsWith(TEAMSPACE_PREFIX) && pageTitles.has(norm(c.title))) continue;
    top.push({ kind: c.kind, id: c.id, title: c.title });
  }
  // a guess is taken only when the title was said whole, or answers every word asked —
  // otherwise the candidates are offered back ("which one?")
  const pick = async (c: Candidate): Promise<Resolved> => {
    if (!(scoreTitle(c.title, expanded) >= 1000 || coversAsked(c.title, query))) return { ambiguous: top.slice(0, 8) };
    const loc = c.kind === "page" ? await src.locate(c.id) : { kind: "database" as const, id: c.id };
    return loc ? { found: { ...loc, title: c.title } } : { none: true };
  };
  if (top.length === 1) return pick(top[0]);
  const hub = await hubOf(top);
  if (hub) return pick(hub);
  // still tied: the title that says least beyond what was asked, when one does
  const cover = top.map((c) => titleCoverage(c.title, expanded));
  const best = Math.max(...cover);
  const winners = top.filter((_, i) => cover[i] === best);
  if (winners.length === 1) return pick(winners[0]);
  return { ambiguous: top.slice(0, 8) };
}

/** Of several equally good pages, the one that holds all the others ("the Chuseok page"
 *  when the Chuseok hub links every other Chuseok page) — else none. */
async function hubOf(cands: Candidate[]): Promise<Candidate | null> {
  const pagesOnly = cands.filter((c) => c.kind === "page" && !c.id.startsWith(TEAMSPACE_PREFIX));
  const hubs: Candidate[] = [];
  for (const c of pagesOnly) {
    const refs = new Set<string>([c.id]);
    const bs = await db
      .select({ type: blocks.type, content: blocks.content })
      .from(blocks)
      .where(and(eq(blocks.pageId, c.id), eq(blocks.alive, true), inArray(blocks.type, ["child_page", "link_to_page", "database"])));
    for (const b of bs) {
      if (b.content?.childPageId) refs.add(b.content.childPageId);
      if (b.content?.databaseId) refs.add(b.content.databaseId);
    }
    for (const k of await db.select({ id: pages.id }).from(pages).where(eq(pages.parentPageId, c.id))) refs.add(k.id);
    // a page embedding a database counts as holding it, and so does a page it links
    const linked = [...refs];
    if (linked.length)
      for (const b of await db
        .select({ content: blocks.content })
        .from(blocks)
        .where(and(inArray(blocks.pageId, linked.filter((x) => /^[0-9a-f-]{36}$/i.test(x))), eq(blocks.type, "database"), eq(blocks.alive, true))))
        if (b.content?.databaseId) refs.add(b.content.databaseId);
    if (cands.every((o) => refs.has(o.id))) hubs.push(c);
  }
  return hubs.length === 1 ? hubs[0] : null;
}

/** Titles of what every reader can see in the workspaces, for asking back ("which page?")
 *  or for the model to pick from when nothing matched by name. */
export async function visibleTitles(readers: Readers & { workspaceIds: string[] }, cap = 60): Promise<Candidate[]> {
  const src = sourceFor(readers);
  const out: Candidate[] = [];
  if (!readers.workspaceIds.length) return out;
  const rows = await db
    .select({ id: pages.id, title: pages.title })
    .from(pages)
    .where(and(inArray(pages.workspaceId, readers.workspaceIds), eq(pages.isArchived, false), sql`${pages.title} <> ''`))
    .orderBy(pages.position);
  for (const p of rows) {
    if (out.length >= cap) break;
    if (isPromptPageTitle(p.title)) continue;
    if (await src.canSee("page", p.id)) out.push({ kind: "page", id: p.id, title: p.title });
  }
  return out;
}

/** The workspaces a person belongs to (for title lookups outside a room). */
export async function workspacesOf(userId: string): Promise<string[]> {
  return (await db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId))).map((r) => r.id);
}

/** Locate an id (a uuid in any spelling or link, a bare OKF id, a teamspace) and check the
 *  readers may see it. Never a title lookup: an id they cannot all see is simply not found. */
export async function locateVisible(input: string, readers: Readers, src: DbSource = sourceFor(readers)): Promise<(Located & { title: string }) | null> {
  const id = idOf(input);
  return id ? locateId(id, src) : null;
}
