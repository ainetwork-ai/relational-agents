import type { FetchOptions, FetchStats, PBlock, PDatabase, PPage, PromptContent, Skipped, TreeNode } from "./model";
import { dateOf } from "./properties";

/**
 * The fetch stage — notion2prompt's fetch_content / NotionFetcher::fetch_recursive,
 * over whatever a PromptSource reads (source-db.ts: Postgres + OKF, permission-checked;
 * the check script: memory). It walks from the root through child pages (sub-page
 * blocks, linked pages, parent/child pages) and child databases, and returns a
 * PromptContent the render stage turns into text.
 *
 * What notion2prompt's options mean here (they are documented upstream but several
 * are dead or off by a factor there; this is their intent):
 *  - depth: levels of child pages below the root (0 = the root alone). A child
 *    database costs one level too, unless alwaysFetchDatabases. A page's own blocks
 *    are always read whole (nesting is guarded at 100 levels by the source).
 *  - limit: one global cap on root + blocks + rows + child pages. What does not fit is
 *    cut in document order and reported.
 *  - childPages: follow child pages at all (upstream's --parse-child-pages).
 *  - alwaysFetchDatabases: resolve every child database whose block was read,
 *    whatever depth is left.
 * Cycles: one visited set of page ids across the whole walk (and the ancestor path,
 * to tell a cycle from a page reached twice). A page is read once; later references
 * stay placeholders.
 *
 * Permissions are the source's: canSee() answers for EVERY person who will read the
 * result. Something they may not all see is never read, keeps no title, and is listed
 * in `skipped` by id and reason only.
 */

export interface SourcePage extends PPage {
  /** children by parent link (ainmem's sidebar nesting), in order — Notion would have
   *  a child_page block for each; those not already referenced by a block are added */
  childPageIds: string[];
}

export interface SourceDatabase extends Omit<PDatabase, "rows"> {
  /** rows as pages (properties, no body); `hasPage` when the row has a body page of its own,
   *  whose id is then the row's id */
  rows: (PPage & { hasPage?: boolean })[];
}

export type Located = { kind: "page" | "database" | "block"; id: string };

export interface PromptSource {
  page(id: string): Promise<SourcePage | null>;
  database(id: string): Promise<SourceDatabase | null>;
  block(id: string): Promise<{ block: PBlock; pageId: string } | null>;
  /** may EVERY reader see it */
  canSee(kind: "page" | "database", id: string): Promise<boolean>;
  /** a visible page's or database's current title */
  title(kind: "page" | "database", id: string): Promise<string | null>;
  /** workspace, teamspace and ancestor names the readers can see — the project path */
  location(root: Located, pageId?: string): Promise<string[]>;
}

export const RESTRICTED_PAGE = "Restricted page";
export const RESTRICTED_DATABASE = "Restricted database";

export const DEFAULT_FETCH: FetchOptions = { depth: 5, limit: 1000, childPages: true, alwaysFetchDatabases: false };
export const MAX_DEPTH = 50;
export const MAX_LIMIT = 100_000;

export function fetchOptions(o: Partial<FetchOptions> = {}): FetchOptions {
  const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : d);
  return {
    depth: Math.min(MAX_DEPTH, Math.max(0, int(o.depth, DEFAULT_FETCH.depth))),
    limit: Math.min(MAX_LIMIT, Math.max(1, int(o.limit, DEFAULT_FETCH.limit))),
    childPages: o.childPages ?? DEFAULT_FETCH.childPages,
    alwaysFetchDatabases: o.alwaysFetchDatabases ?? DEFAULT_FETCH.alwaysFetchDatabases,
  };
}

export class PromptNotFound extends Error {
  constructor() {
    super("not found");
  }
}

export function countBlocks(blocks: PBlock[] | undefined): number {
  let n = 0;
  for (const b of blocks ?? []) n += 1 + countBlocks(b.children);
  return n;
}

/** The first `n` blocks in document order, nesting kept. */
export function truncateTree(blocks: PBlock[], n: number): PBlock[] {
  let left = n;
  const walk = (list: PBlock[]): PBlock[] => {
    const out: PBlock[] = [];
    for (const b of list) {
      if (left <= 0) break;
      left--;
      out.push(b.children ? { ...b, children: walk(b.children) } : { ...b });
    }
    return out;
  };
  return walk(blocks);
}

/** notion2prompt's sort_pages_by_date_desc: by the first property holding a native date
 *  (else any date-like one), newest first; rows without one keep their order, last. */
export function sortRowsByDate<T extends PPage>(rows: T[]): T[] {
  const first = (pred: (v: PPage["properties"][number]["value"]) => boolean) => {
    for (const r of rows) for (const p of r.properties) if (pred(p.value)) return p.name;
    return null;
  };
  const name = first((v) => v.type === "date" && !!v.start) ?? first((v) => dateOf(v) !== null);
  if (!name) return rows;
  const d = (r: PPage) => dateOf(r.properties.find((p) => p.name === name)?.value);
  return [...rows].sort((a, b) => {
    const x = d(a);
    const y = d(b);
    if (x && y) return x < y ? 1 : x > y ? -1 : 0;
    if (x) return -1;
    if (y) return 1;
    return 0;
  });
}

function refsOf(blocks: PBlock[], out = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if ((b.type === "child_page" && b.pageId) || b.type === "link_to_page") out.add(b.pageId!);
    if (b.children) refsOf(b.children, out);
  }
  return out;
}

export async function collect(root: Located, options: Partial<FetchOptions>, src: PromptSource): Promise<PromptContent> {
  const opts = fetchOptions(options);
  const pages: Record<string, PPage> = {};
  const databases: Record<string, PDatabase> = {};
  const skipped: Skipped[] = [];
  const stats: FetchStats = { pages: 0, databases: 0, rows: 0, blocks: 0, items: 0, maxDepthReached: 0, depthLimited: false, limitReached: false };
  const visitedPages = new Set<string>();
  const visitedDbs = new Set<string>();

  /** take up to n items from the budget */
  const take = (n: number) => {
    const ok = Math.max(0, Math.min(n, opts.limit - stats.items));
    stats.items += ok;
    if (ok < n) stats.limitReached = true;
    return ok;
  };
  const skip = (s: Skipped) => {
    if (!skipped.some((x) => x.id === s.id && x.reason === s.reason && x.kind === s.kind)) skipped.push(s);
  };

  async function pageRef(b: Extract<PBlock, { type: "child_page" | "link_to_page" }>, level: number, node: TreeNode, path: Set<string>) {
    const id = b.pageId;
    if (!id) return;
    if (!(await src.canSee("page", id))) {
      if (b.type === "child_page") b.title = RESTRICTED_PAGE;
      else delete b.title;
      skip({ reason: "permission", kind: "page", id });
      return;
    }
    const title = await src.title("page", id);
    if (b.type === "child_page") b.title = title ?? (b.title || "Untitled");
    else if (title !== null) b.title = title;
    if (!opts.childPages) return;
    if (path.has(id)) return skip({ reason: "cycle", kind: "page", id });
    if (visitedPages.has(id)) return skip({ reason: "duplicate", kind: "page", id });
    if (level + 1 > opts.depth) {
      stats.depthLimited = true;
      return skip({ reason: "depth", kind: "page", id });
    }
    if (stats.items >= opts.limit) {
      stats.limitReached = true;
      return skip({ reason: "limit", kind: "page", id });
    }
    visitedPages.add(id);
    const via = b.type === "link_to_page" ? "link_to_page" : b.id.startsWith("child:") ? "parent" : "child_page";
    const child: TreeNode = { kind: "page", id, title: b.title ?? "", via, children: [] };
    if (await fetchPage(id, level + 1, child, new Set([...path, id]))) node.children.push(child);
  }

  async function dbRef(b: Extract<PBlock, { type: "child_database" }>, level: number, node: TreeNode) {
    const id = b.content.state === "not_fetched" || b.content.state === "fetched" ? b.content.databaseId : undefined;
    if (!id) return;
    if (!(await src.canSee("database", id))) {
      b.title = RESTRICTED_DATABASE;
      b.content = { state: "inaccessible" };
      return skip({ reason: "permission", kind: "database", id });
    }
    b.title = (await src.title("database", id)) ?? (b.title || "Untitled Database");
    if (databases[id] || visitedDbs.has(id)) {
      b.content = { state: "fetched", databaseId: id };
      return;
    }
    if (level + 1 > opts.depth && !opts.alwaysFetchDatabases) {
      stats.depthLimited = true;
      b.content = { state: "not_fetched", databaseId: id };
      return skip({ reason: "depth", kind: "database", id });
    }
    if (stats.items >= opts.limit) {
      stats.limitReached = true;
      b.content = { state: "not_fetched", databaseId: id };
      return skip({ reason: "limit", kind: "database", id });
    }
    const ok = await fetchDatabase(id, level + 1, node, false);
    b.content = ok ? { state: "fetched", databaseId: id } : { state: "not_fetched", databaseId: id };
  }

  async function walk(blocks: PBlock[], level: number, node: TreeNode, path: Set<string>) {
    for (const b of blocks) {
      if (b.type === "child_page" || b.type === "link_to_page") await pageRef(b, level, node, path);
      else if (b.type === "child_database") await dbRef(b, level, node);
      if (b.children?.length) await walk(b.children, level, node, path);
    }
  }

  /** `counted`: the page's own item is already paid for (a root database's row) */
  async function fetchPage(id: string, level: number, node: TreeNode, path: Set<string>, counted = false): Promise<boolean> {
    const p = await src.page(id);
    if (!p) {
      skip({ reason: "missing", kind: "page", id });
      return false;
    }
    if (!counted && !take(1)) {
      skip({ reason: "limit", kind: "page", id });
      return false;
    }
    stats.pages++;
    stats.maxDepthReached = Math.max(stats.maxDepthReached, level);
    let blocks = p.blocks;
    // parent/child pages no block points at: Notion would show each as a sub-page block
    const referenced = refsOf(blocks);
    const extra: PBlock[] = [];
    for (const cid of p.childPageIds) {
      if (referenced.has(cid)) continue;
      if (!(await src.canSee("page", cid))) {
        skip({ reason: "permission", kind: "page", id: cid });
        continue;
      }
      extra.push({ id: `child:${cid}`, type: "child_page", title: "", pageId: cid });
    }
    blocks = [...blocks, ...extra];
    const n = countBlocks(blocks);
    const ok = take(n);
    if (ok < n) {
      blocks = truncateTree(blocks, ok);
      skip({ reason: "limit", kind: "block", id });
    }
    stats.blocks += ok;
    const page: PPage = { id: p.id, title: p.title, url: p.url, properties: p.properties, blocks, ...(p.icon !== undefined ? { icon: p.icon } : {}) };
    pages[id] = page;
    node.title = page.title;
    await walk(blocks, level, node, path);
    return true;
  }

  async function fetchDatabase(id: string, level: number, node: TreeNode, asRoot: boolean): Promise<boolean> {
    visitedDbs.add(id);
    const d = await src.database(id);
    if (!d) {
      skip({ reason: "missing", kind: "database", id });
      return false;
    }
    if (!take(1)) {
      skip({ reason: "limit", kind: "database", id });
      return false;
    }
    stats.databases++;
    let rows = sortRowsByDate(d.rows);
    const ok = take(rows.length);
    if (ok < rows.length) {
      rows = rows.slice(0, ok);
      skip({ reason: "limit", kind: "row", id });
    }
    stats.rows += ok;
    databases[id] = { id: d.id, title: d.title, ...(d.url ? { url: d.url } : {}), schema: d.schema, rows: rows.map((r) => {
      const { hasPage, ...row } = r;
      void hasPage;
      return row;
    }) };
    const dbNode: TreeNode = asRoot ? node : { kind: "database", id, title: d.title, via: "child_database", children: [] };
    if (asRoot) node.title = d.title;
    else node.children.push(dbNode);
    // a root database's rows are pages: their bodies are read like child pages
    if (asRoot && opts.childPages)
      for (const r of rows) {
        if (!r.hasPage || visitedPages.has(r.id)) continue;
        if (level + 1 > opts.depth) {
          stats.depthLimited = true;
          skip({ reason: "depth", kind: "page", id: r.id });
          continue;
        }
        if (!(await src.canSee("page", r.id))) {
          skip({ reason: "permission", kind: "page", id: r.id });
          continue;
        }
        if (stats.items >= opts.limit) {
          stats.limitReached = true;
          skip({ reason: "limit", kind: "page", id: r.id });
          continue;
        }
        visitedPages.add(r.id);
        const child: TreeNode = { kind: "page", id: r.id, title: r.title, via: "row", children: [] };
        if (await fetchPage(r.id, level + 1, child, new Set([r.id]), true)) {
          // the row's properties are the database's, whatever the page carries
          pages[r.id].properties = r.properties;
          dbNode.children.push(child);
        }
      }
    return true;
  }

  let content: PromptContent["root"];
  const tree: TreeNode = { kind: root.kind === "database" ? "database" : "page", id: root.id, title: "", children: [] };
  let pageOfBlock: string | undefined;
  if (root.kind === "page") {
    if (!(await src.canSee("page", root.id))) throw new PromptNotFound();
    visitedPages.add(root.id);
    if (!(await fetchPage(root.id, 0, tree, new Set([root.id])))) throw new PromptNotFound();
    content = { kind: "page", id: root.id };
  } else if (root.kind === "database") {
    if (!(await src.canSee("database", root.id))) throw new PromptNotFound();
    if (!(await fetchDatabase(root.id, 0, tree, true))) throw new PromptNotFound();
    content = { kind: "database", id: root.id };
  } else {
    const found = await src.block(root.id);
    if (!found || !(await src.canSee("page", found.pageId))) throw new PromptNotFound();
    pageOfBlock = found.pageId;
    visitedPages.add(found.pageId);
    take(1);
    let blocks = [found.block];
    const n = countBlocks(blocks);
    const ok = take(n);
    if (ok < n) {
      blocks = truncateTree(blocks, ok);
      skip({ reason: "limit", kind: "block", id: root.id });
    }
    stats.blocks += ok;
    tree.title = `Block ${root.id}`;
    await walk(blocks, 0, tree, new Set([found.pageId]));
    content = { kind: "block", block: blocks[0], pageId: found.pageId };
  }
  // a page skipped for depth on one path may have been read on a shorter one
  const kept = skipped.filter((x) => !(x.reason === "depth" && (x.kind === "page" ? pages[x.id] : databases[x.id])));
  stats.depthLimited = kept.some((x) => x.reason === "depth");
  return {
    version: 1,
    root: content,
    pages,
    databases,
    tree,
    location: { segments: await src.location(root, pageOfBlock) },
    stats,
    skipped: kept,
    options: opts,
  };
}
