import "server-only";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { blocks, pages, workspaces } from "@/lib/db/schema";
import type { Block, Page } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { inlineHtmlToMd } from "@/lib/rich-text";

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

function blocksToMd(all: Block[], parentId: string | null, indent = ""): string {
  const rows = all
    .filter((b) => (b.parentBlockId ?? null) === parentId)
    .sort((a, b) => a.position - b.position);

  const out: string[] = [];
  let n = 0;
  for (const b of rows) {
    const text = b.content.html
      ? inlineHtmlToMd(b.content.html)
      : b.content.text ?? "";
    n = b.type === "numbered_list" ? n + 1 : 0;
    switch (b.type) {
      case "heading1": out.push(`${indent}# ${text}`); break;
      case "heading2": out.push(`${indent}## ${text}`); break;
      case "heading3": out.push(`${indent}### ${text}`); break;
      case "bulleted_list": out.push(`${indent}- ${text}`); break;
      case "numbered_list": out.push(`${indent}${n}. ${text}`); break;
      case "todo": out.push(`${indent}- [${b.content.checked ? "x" : " "}] ${text}`); break;
      case "quote": out.push(`${indent}> ${text}`); break;
      case "callout": out.push(`${indent}> 💡 ${text}`); break;
      case "divider": out.push(`${indent}---`); break;
      case "code":
        out.push(`${indent}\`\`\`${b.content.language ?? ""}`);
        out.push(text);
        out.push(`${indent}\`\`\``);
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
          const esc = (s: string) => (s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
          const width = Math.max(...t.cells.map((row) => row.length));
          const pad = (row: string[]) =>
            Array.from({ length: width }, (_, i) => esc(row[i] ?? ""));
 // GFM tables require a header row; use the first row as header.
          out.push(`${indent}| ${pad(t.cells[0]).join(" | ")} |`);
          out.push(`${indent}| ${Array(width).fill("---").join(" | ")} |`);
          for (let i = 1; i < t.cells.length; i++) {
            out.push(`${indent}| ${pad(t.cells[i]).join(" | ")} |`);
          }
        }
        break;
      }
      case "toggle": {
        out.push(`${indent}<details><summary>${text}</summary>`);
        out.push("");
        out.push(blocksToMd(all, b.id, indent));
        out.push(`${indent}</details>`);
        break;
      }
      default: out.push(`${indent}${text}`);
    }
    out.push("");
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
    const md = fm(page) + blocksToMd(blocksByPage.get(page.id) ?? [], null);
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

export async function mirrorWorkspace(workspaceId: string): Promise<void> {
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
        .where(inArray(blocks.pageId, pageList.map((p) => p.id)))
    : [];
  const blocksByPage = new Map<string, Block[]>();
  for (const b of blockRows) {
    const list = blocksByPage.get(b.pageId) ?? [];
    list.push(b);
    blocksByPage.set(b.pageId, list);
  }

  const wsDir = path.join(MIRROR_ROOT, slug(ws.name, ws.id));
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
