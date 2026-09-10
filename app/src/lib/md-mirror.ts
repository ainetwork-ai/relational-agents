import "server-only";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { blocks, pages, workspaces } from "@/lib/db/schema";
import type { Block, Page } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { inlineHtmlToMd } from "@/lib/rich-text";
import { escapeMarker } from "@/lib/memory-parse";
import { columnAlign } from "@/lib/editor/table-data";

/**
 * Markdown mirror — the workspace's canonical open-knowledge representation.
 * Page tree ⇢ folder tree; every page is a .md file with YAML frontmatter.
 * DB stays the write model; the mirror is re-exported (debounced, atomically
 * via tmp-dir swap) after every mutation.
 *
 * md-mirror/<workspace-slug>-<id6>/
 * Getting-Started-a1b2c3.md ← leaf page
 * Projects-d4e5f6/ ← page with children
 * _page.md ← its own content
 * Roadmap-778899.md ← child page
 */

const MIRROR_ROOT =
  process.env.MD_MIRROR_ROOT ?? path.join(process.cwd(), "..", "md-mirror");

function slug(title: string, id: string): string {
  const s = (title || "untitled")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${s || "untitled"}-${id.slice(0, 6)}`;
}

function fm(page: Page): string {
  const lines = [
    "---",
    `id: ${page.id}`,
    `title: ${JSON.stringify(page.title || "Untitled")}`,
    ...(page.icon ? [`icon: ${JSON.stringify(page.icon)}`] : []),
    ...(page.parentPageId ? [`parent: ${page.parentPageId}`] : []),
    ...(page.isFavorite ? ["favorite: true"] : []),
    `created: ${new Date(page.createdAt).toISOString()}`,
    `updated: ${new Date(page.updatedAt).toISOString()}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

 // Blank lines exactly where the original puts them: none between two list
 // items, one around anything else, indented to the deeper of the two blocks it
 // separates (scratchpad/nind-M3-clipboard.json).
const LISTISH = new Set(["bulleted_list", "numbered_list", "todo", "toggle"]);
type PrevBlock = { type: string; pad: string } | null;

function blocksToMd(all: Block[], parentId: string | null, indent = "", seen?: Set<string>, prevBox?: { prev: PrevBlock }): string {
 // Roots are parentBlockId === null, but a block whose parent row is gone (a
 // delete that did not cascade) or whose chain loops is reachable from nowhere.
 // The .md route keeps those (memory-parse treeOrder); the mirror used to drop
 // them silently, so live content was missing from the file it calls canonical.
  const mark = seen ?? new Set<string>();
  const top = parentId === null && !seen;
  const rows = all
    .filter((b) => (b.parentBlockId ?? null) === parentId && !mark.has(b.id))
    .sort((a, b) => a.position - b.position);
  for (const r of rows) mark.add(r.id);

  const out: string[] = [];
  const box = prevBox ?? { prev: null as PrevBlock };
  let n = 0;
  for (const b of rows) {
    if (box.prev && !(LISTISH.has(box.prev.type) && LISTISH.has(b.type))) {
      out.push(box.prev.pad.length >= indent.length ? box.prev.pad : indent);
    }
    box.prev = { type: b.type, pad: indent };
    const text = b.content.html
      ? inlineHtmlToMd(b.content.html)
      : b.content.text ?? "";
    n = b.type === "numbered_list" ? n + 1 : 0;
 // How far this block's own children — and its own soft line breaks — sit from
 // its marker. A `100. ` item needs five, not four: at four the child lands
 // left of the item's content column and reads back as a sibling.
    const step =
      b.type === "numbered_list" ? Math.max(4, `${n}. `.length)
      : LISTISH.has(b.type) ? 4
      : 0;
 // A line break inside the text must land on the content column. At column 0
 // (what `${indent}${text}` did) it closes the list and flattens everything
 // nested below; a line that starts like a marker also has to be escaped or it
 // comes back as a bullet/heading of its own.
    const write = (first: string, body = "") => {
      const parts = String(body).split("\n");
      out.push(indent + first + parts[0]);
      for (const l of parts.slice(1)) out.push(indent + " ".repeat(step) + escapeMarker(l));
    };
    switch (b.type) {
      case "heading1": write("# ", text); break;
      case "heading2": write("## ", text); break;
      case "heading3": write("### ", text); break;
      case "bulleted_list": write("- ", text); break;
      case "numbered_list": write(`${n}. `, text); break;
      case "todo": write(`- [${b.content.checked ? "x" : " "}]  `, text); break;
      case "quote": write("> ", text); break;
      case "callout": write(`> ${b.content.icon || "💡"} `, text); break;
      case "divider": out.push(`${indent}---`); break;
      case "code": {
 // a body containing ``` closed the block early and everything after it was
 // lost — open with one backtick more than the longest run inside
        const fence = "`".repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((m) => m.length + 1), 3));
        out.push(`${indent}${fence}${b.content.language ?? ""}`);
        for (const l of text.split("\n")) out.push(`${indent}${l}`);
        out.push(`${indent}${fence}`);
        break;
      }
 // `$$ … $$` is how the reader recognises an equation; without the fences it
 // came back as a paragraph of LaTeX
      case "equation":
        if (text) {
          out.push(`${indent}$$`);
          for (const l of text.split("\n")) out.push(`${indent}${l}`);
          out.push(`${indent}$$`);
        }
        break;
 // a link to a subpage is content, not decoration — the mirror dropped it
      case "link_to_page":
        if (b.content.childPageId) out.push(`${indent}[page](/p/${b.content.childPageId})`);
        break;
      case "file":
        if (b.content.url) out.push(`${indent}[${b.content.text || "file"}](${b.content.url})`);
        break;
      case "image":
        if (b.content.url) out.push(`${indent}![${text}](${b.content.url})`);
        break;
      case "database":
        out.push(`${indent}> 📊 Database (${b.content.databaseId ?? "unlinked"})`);
        break;
      case "table": {
        const t = b.content.table;
        if (t?.cells?.length) {
          const esc = (s: string) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
          const width = Math.max(...t.cells.map((row) => row.length));
 // a cell with its own html mirrors as markdown (**bold**, `code`, links)
          const pad = (row: string[], ri: number) =>
            Array.from({ length: width }, (_, i) => {
              const rich = t.html?.[ri]?.[i];
              return esc(rich ? inlineHtmlToMd(rich) : row[i] ?? "");
            });
 // GFM tables require a header row; use the first row as header.
          out.push(`${indent}| ${pad(t.cells[0], 0).join(" | ")} |`);
 // markdown can only align per column, so the column's first row decides
          const bar = Array.from({ length: width }, (_, i) => {
            const a = columnAlign(t, i);
            return a === "center" ? ":---:" : a === "right" ? "---:" : "---";
          });
          out.push(`${indent}| ${bar.join(" | ")} |`);
          for (let i = 1; i < t.cells.length; i++) {
            out.push(`${indent}| ${pad(t.cells[i], i).join(" | ")} |`);
          }
        }
        break;
      }
 // the original writes a toggle as a plain bullet and indents its children;
 // <details> looked right in a viewer but came back flat
      case "toggle": write("- ", text); break;
      default: write("", escapeMarker(text));
    }
 // EVERY block can have children, not just a toggle. Without this the mirror
 // silently dropped a paragraph's or a bullet's nested blocks from the file
 // (docs/notion-indent.md §6(3)) — four spaces per level is what the original
 // writes, and it reads back as the same tree.
 // only a LIST item indents its children — the original exports a paragraph's
 // child flat, and reads an indented line after a blank one as a code block
    const kids = blocksToMd(all, b.id, indent + " ".repeat(step), mark, box);
    if (kids.trim()) { out.push(kids); }
  }
  if (top) {
 // whatever the walk never reached — from its own root, at the left margin
    for (const b of [...all].sort((a, c) => a.position - c.position)) {
      if (mark.has(b.id)) continue;
      const orphan = blocksToMd(all.map((x) => (x.id === b.id ? { ...x, parentBlockId: null } : x)), null, indent, mark, box);
      if (orphan.trim()) out.push(orphan);
    }
  }
  return out.join("\n");
}

async function writeTree(
  dir: string,
  pageList: Page[],
  blocksByPage: Map<string, Block[]>,
  parentId: string | null
): Promise<void> {
  const children = pageList
    .filter((p) => (p.parentPageId ?? null) === parentId)
    .sort((a, b) => a.position - b.position);

  for (const page of children) {
    const md = `${fm(page)}${blocksToMd(blocksByPage.get(page.id) ?? [], null)}\n`;
    const hasKids = pageList.some((p) => p.parentPageId === page.id);
    const name = slug(page.title, page.id);
    if (hasKids) {
      const sub = path.join(dir, name);
      await mkdir(sub, { recursive: true });
      await writeFile(path.join(sub, "_page.md"), md);
      await writeTree(sub, pageList, blocksByPage, page.id);
    } else {
      await writeFile(path.join(dir, `${name}.md`), md);
    }
  }
}

/** One mirror run per workspace at a time. Two overlapping runs each did
 * `rm -rf <ws>` then `rename(<ws>.tmp-… → <ws>)`, which left `.tmp-` directories
 * behind and made anything reading the mirror (the export zip) hit ENOENT
 * mid-walk. */
const RUNS_KEY = Symbol.for("app.mdmirror.runs");
function runs(): Map<string, Promise<void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<void>>>;
  if (!g[RUNS_KEY]) g[RUNS_KEY] = new Map();
  return g[RUNS_KEY];
}

export function mirrorWorkspace(workspaceId: string): Promise<void> {
  const inflight = runs();
  const prev = inflight.get(workspaceId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => mirrorWorkspaceOnce(workspaceId));
  inflight.set(workspaceId, next);
  void next.finally(() => {
    if (inflight.get(workspaceId) === next) inflight.delete(workspaceId);
  });
  return next;
}

async function mirrorWorkspaceOnce(workspaceId: string): Promise<void> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) return;

  const pageList = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.isArchived, false)));

  const blockRows = pageList.length
    ? await db
        .select()
        .from(blocks)
        .where(and(inArray(blocks.pageId, pageList.map((p) => p.id)), eq(blocks.alive, true)))
    : [];
  const blocksByPage = new Map<string, Block[]>();
  for (const b of blockRows) {
    const list = blocksByPage.get(b.pageId) ?? [];
    list.push(b);
    blocksByPage.set(b.pageId, list);
  }

  const wsDir = path.join(MIRROR_ROOT, slug(ws.name, ws.id));
 // sweep leftovers from runs that died between rm and rename
  try {
    const base = path.basename(wsDir);
    for (const name of await readdir(MIRROR_ROOT)) {
      if (name.startsWith(`${base}.tmp-`)) await rm(path.join(MIRROR_ROOT, name), { recursive: true, force: true });
    }
  } catch { /* first run: the root may not exist yet */ }
  const tmpDir = `${wsDir}.tmp-${Date.now()}`;
  await mkdir(tmpDir, { recursive: true });
  await writeTree(tmpDir, pageList, blocksByPage, null);
  await rm(wsDir, { recursive: true, force: true });
  await rename(tmpDir, wsDir);
}

// -- debounced scheduling (survives dev HMR via globalThis) -----------------

const TIMER_KEY = Symbol.for("app.mdmirror.timers");

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  const g = globalThis as unknown as Record<
    symbol,
    Map<string, ReturnType<typeof setTimeout>>
  >;
  if (!g[TIMER_KEY]) g[TIMER_KEY] = new Map();
  return g[TIMER_KEY];
}

/** Debounced (500ms) full re-export of one workspace's mirror. */
export function scheduleMirror(workspaceId: string): void {
  const map = timers();
  const existing = map.get(workspaceId);
  if (existing) clearTimeout(existing);
  map.set(
    workspaceId,
    setTimeout(() => {
      map.delete(workspaceId);
      mirrorWorkspace(workspaceId).catch((err) =>
        console.error("[md-mirror] export failed:", err)
      );
    }, 500)
  );
}
