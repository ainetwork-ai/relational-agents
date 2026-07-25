import "server-only";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { okfDbMeta } from "@/lib/db/schema";
import {
  parseMarkdown,
  parseCsvDatabase,
  parseCsv,
  toCsv,
  cleanTitle,
  blocksToMarkdown,
  serializeFrontmatter,
  parseDateCell,
  multiTokens,
  type ParsedBlock,
  type Frontmatter,
  type FsProperty,
  type FsRow,
  optionIdFor,
  optionColorFor,
} from "@/lib/notion-parse";
import type {
  Block,
  Page,
  Database,
  DbProperty,
  DbRow,
  DbView,
  PropertyType,
  PropertyConfig,
  SelectOption,
  ViewConfig,
} from "@/lib/db/schema";

// ===========================================================================
// OKF store: the folder tree at NOTION_FS_ROOT *is* the content database.
// Path = identity. .md = a page (YAML frontmatter + body). A folder with an
// index.md is a page with children. .csv = a database (schema + rows).
// No SQL — reads/writes the files directly.
// ===========================================================================

export function okfRoot(): string {
  return process.env.NOTION_FS_ROOT || path.join(process.cwd(), "notion-fs");
}

// Opaque, single-segment page id = base64url of the posix relative path. Lets
// the existing /p/[pageId] route + string-keyed stores treat file content the
// same as a Postgres row (migration blueprint: identity bridge).
export function encodeId(relPath: string): string {
  return Buffer.from(relPath, "utf8").toString("base64url");
}
export function decodeId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

// The identity bridge: a Postgres page id is a UUID; an OKF id is the base64url
// of a relative path. Anything that isn't a UUID and decodes to a non-empty
// string is treated as OKF, so the one /p/[id] route + /api/pages serve both.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isOkfId(id: string): boolean {
  if (UUID_RE.test(id)) return false;
  try {
    return decodeId(id).length > 0;
  } catch {
    return false;
  }
}

const ROW_SEP = "#";
/** Opaque rel path for a CSV row-as-page: `${csv}#${rowId}`. */
export function rowPageRel(csvRelPath: string, rowId: string): string {
  return `${csvRelPath}${ROW_SEP}${rowId}`;
}
/** Split a row-page rel path back into its CSV + row id (null if not one). */
export function parseRowPageRel(rel: string): { csvRelPath: string; rowId: string } | null {
  const i = rel.lastIndexOf(ROW_SEP);
  if (i < 0) return null;
  const csvRelPath = rel.slice(0, i);
  const rowId = rel.slice(i + 1);
  if (!isCsv(csvRelPath) || !rowId) return null;
  return { csvRelPath, rowId };
}
/** A row's editable body lives in a sidecar md beside the CSV. */
function rowSidecarRel(csvRelPath: string, rowId: string): string {
  const dir = path.posix.dirname(csvRelPath);
  const base = path.posix.basename(csvRelPath).replace(/\.csv$/i, "");
  const sub = `${base}.rows/${rowId}.md`;
  return dir === "." ? sub : `${dir}/${sub}`;
}

function resolveSafe(rel: string): string {
  const root = okfRoot();
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("path escapes root");
  return abs;
}

export type NodeKind = "folder" | "page" | "database";
export interface TreeNode {
  id: string; // relative path (posix) — the OKF identity
  name: string;
  kind: NodeKind;
  children?: TreeNode[];
}

function isCsv(n: string) {
  return /\.csv$/i.test(n) && !/_all\.csv$/i.test(n);
}

/** A Notion export of a database with a filtered view writes `<db>.csv` (just
 * the view's rows — Status subset, empty columns) AND `<db>_all.csv` (EVERY
 * row and value). The view file stays the node's IDENTITY (tree/sidebar/meta
 * key), but the full file is the real data backend: all reads and writes
 * target `_all.csv` when it exists. */
function dataCsvRel(rel: string): string {
  const allRel = rel.replace(/\.csv$/i, "_all.csv");
  try {
    if (fs.existsSync(resolveSafe(allRel))) return allRel;
  } catch {
    /* out-of-root variant → fall back to the view csv */
  }
  return rel;
}
function rel(abs: string): string {
  return path.relative(okfRoot(), abs).split(path.sep).join("/");
}

function buildDir(absDir: string): TreeNode[] {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());

  for (const d of dirs) {
    const abs = path.join(absDir, d.name);
    const children = buildDir(abs);
    const hasIndex = fs.existsSync(path.join(abs, "index.md"));
    nodes.push({
      id: rel(abs),
      name: cleanTitle(d.name),
      kind: hasIndex ? "page" : "folder",
      children,
    });
  }
  for (const f of files) {
    if (f.name.toLowerCase() === "index.md") continue;
    if (/\.md$/i.test(f.name)) nodes.push({ id: rel(path.join(absDir, f.name)), name: cleanTitle(f.name), kind: "page" });
    else if (isCsv(f.name)) nodes.push({ id: rel(path.join(absDir, f.name)), name: cleanTitle(f.name), kind: "database" });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

export function listTree(): TreeNode[] {
  const root = okfRoot();
  if (!fs.existsSync(root)) return [];
  return buildDir(root);
}

/** Flat, Postgres-Page-shaped list (encoded ids + parent links) for the
 * sidebar store. The migration swaps /api/pages to return this. */
export interface PageLike {
  id: string;
  parentPageId: string | null;
  title: string;
  icon: string;
  isArchived: boolean;
  isFavorite: boolean;
  position: number;
  kind: NodeKind;
}
export function listPages(): PageLike[] {
  const out: PageLike[] = [];
  let pos = 0;
  const walk = (nodes: TreeNode[], parentId: string | null) => {
    for (const n of nodes) {
      const id = encodeId(n.id);
      out.push({
        id,
        parentPageId: parentId,
        title: n.name,
        icon: n.kind === "database" ? "🗂️" : "📄",
        isArchived: false,
        isFavorite: false,
        position: ++pos,
        kind: n.kind,
      });
      if (n.children) walk(n.children, id);
    }
  };
  walk(listTree(), null);
  return out;
}

export interface PageNode {
  kind: "page";
  id: string;
  title: string;
  meta: Frontmatter;
  blocks: ParsedBlock[];
  children: TreeNode[];
}
export interface DatabaseNode {
  kind: "database";
  id: string;
  title: string;
  properties: FsProperty[];
  rows: FsRow[];
  totalRows: number;
}
/** A CSV row rendered as its own page: its property values + an
 * editable body (sidecar md). */
export interface RowPageNode {
  kind: "row";
  id: string;
  title: string;
  dbId: string;
  dbTitle: string;
  properties: FsProperty[];
  row: FsRow;
  meta: Frontmatter;
  blocks: ParsedBlock[];
}

const DB_ROW_LIMIT = 500;
export type ContentNode = PageNode | DatabaseNode | RowPageNode;

/** A Notion export writes a DB row's page .md with the row's PROPERTIES as
 * leading "Key: Value" paragraphs right after the title — but the app already
 * renders properties from the CSV (peek panel / table), so those lines would
 * show twice. If this .md sits in a row-page folder (parent folder named after
 * a sibling CSV), drop the leading run of paragraphs whose key matches a CSV
 * header. Non-row pages are untouched. */
function stripExportPropertyBlock(relPath: string, blocks: ParsedBlock[]): ParsedBlock[] {
  const dir = path.posix.dirname(relPath);
  if (!dir || dir === ".") return blocks;
  const folderName = path.posix.basename(dir);
  const parentRel = path.posix.dirname(dir);
  let headers: Set<string> | null = null;
  try {
    const parentAbs = resolveSafe(parentRel === "." ? "" : parentRel);
    for (const name of fs.readdirSync(parentAbs)) {
      if (!isCsv(name) || cleanTitle(name) !== folderName) continue;
      // prefer the full-export file's headers (a filtered-view csv can lack columns)
      const allName = name.replace(/\.csv$/i, "_all.csv");
      const target = fs.existsSync(path.join(parentAbs, allName)) ? allName : name;
      // header row only — row-page reads must not pay a full parse of a huge CSV
      const fd = fs.openSync(path.join(parentAbs, target), "r");
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const firstLine = buf.subarray(0, n).toString("utf8").split("\n")[0];
      headers = new Set(parseCsv(firstLine)[0]?.map((h) => h.trim()).filter(Boolean));
      break;
    }
  } catch {
    return blocks;
  }
  if (!headers || headers.size === 0) return blocks;
  let i = 0;
  while (i < blocks.length && blocks[i].type === "paragraph") {
    const m = (blocks[i].content.text ?? "").match(/^(.{1,60}?):(\s|$)/);
    if (m && headers.has(m[1].trim())) i++;
    else break;
  }
  return i > 0 ? blocks.slice(i) : blocks;
}

/** Rewrite an OKF page's relative asset URLs (image/video blocks) to the
 * asset-serving endpoint. An exported Notion page references its files as
 * local, URL-encoded paths relative to the .md (`folder/img.png`); the browser
 * can't fetch those, so resolve each against the page's directory and point it
 * at /api/okf/asset with the encoded OKF path. Leaves http(s)/data/api URLs. */
function rewriteAssetBlocks(blocks: ParsedBlock[], baseDir: string): ParsedBlock[] {
  return blocks.map((b) => {
    if (b.type !== "image") return b;
    const url = typeof b.content.url === "string" ? b.content.url : "";
    if (!url || /^(https?:|data:|blob:|\/api\/)/i.test(url)) return b;
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      decoded = url;
    }
    const dir = baseDir === "." ? "" : baseDir;
    const joined = path.posix.normalize(path.posix.join(dir, decoded.replace(/^\/+/, "")));
    if (joined.startsWith("..")) return b; // never escape the tree
    return { ...b, content: { ...b.content, url: `/api/okf/asset?p=${encodeId(joined)}` } };
  });
}

/** Resolve a CSV row into a RowPageNode. */
function readRowPage(csvRelPath: string, rowId: string): RowPageNode | null {
  const csvAbs = resolveSafe(csvRelPath);
  if (!fs.existsSync(csvAbs) || !isCsv(csvAbs)) return null;
  const dataAbs = resolveSafe(dataCsvRel(csvRelPath));
  const { properties, rows } = parseCsvDatabase(fs.readFileSync(dataAbs, "utf8"), DB_ROW_LIMIT);
  const row = rows.find((r) => r.id === rowId);
  if (!row) return null;
  const titleProp = properties.find((p) => p.type === "title") ?? properties[0];
  const rawTitle = titleProp ? row.values[titleProp.id] : undefined;
  const title =
    rawTitle === undefined || rawTitle === null || rawTitle === "" ? "Untitled" : String(rawTitle);
  const sidecarAbs = resolveSafe(rowSidecarRel(csvRelPath, rowId));
  let meta: Frontmatter = {};
  let blocks: ParsedBlock[] = [];
  if (fs.existsSync(sidecarAbs)) {
    const parsed = parseMarkdown(fs.readFileSync(sidecarAbs, "utf8"), "b");
    meta = parsed.meta;
    blocks = rewriteAssetBlocks(parsed.blocks, path.posix.dirname(rowSidecarRel(csvRelPath, rowId)));
  }
  return {
    kind: "row",
    id: rowPageRel(csvRelPath, rowId),
    title,
    dbId: csvRelPath,
    dbTitle: cleanTitle(path.basename(csvAbs)),
    properties,
    row,
    meta,
    blocks,
  };
}

export function readNode(relPath: string): ContentNode | null {
  // Row-as-page (`${csv}#${rowId}`) is resolved before resolveSafe — the `#`
  // isn't a real path segment.
  const rp = parseRowPageRel(relPath);
  if (rp) return readRowPage(rp.csvRelPath, rp.rowId);

  const abs = resolveSafe(relPath);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);

  if (stat.isDirectory()) {
    const indexAbs = path.join(abs, "index.md");
    const md = fs.existsSync(indexAbs) ? fs.readFileSync(indexAbs, "utf8") : "";
    const { title, meta, blocks } = parseMarkdown(md, "b");
    return {
      kind: "page",
      id: relPath,
      title: title !== "Untitled" ? title : cleanTitle(path.basename(abs)),
      meta,
      // index.md's assets are relative to the folder itself
      blocks: rewriteAssetBlocks(blocks, relPath),
      children: buildDir(abs),
    };
  }
  if (isCsv(abs)) {
    // full data from `_all.csv` when the export split view/full files
    const dataAbs = resolveSafe(dataCsvRel(relPath));
    const { properties, rows, totalRows } = parseCsvDatabase(fs.readFileSync(dataAbs, "utf8"), DB_ROW_LIMIT);
    return { kind: "database", id: relPath, title: cleanTitle(path.basename(abs)), properties, rows, totalRows };
  }
  if (/\.md$/i.test(abs)) {
    const { title, meta, blocks } = parseMarkdown(fs.readFileSync(abs, "utf8"), "b");
    return {
      kind: "page",
      id: relPath,
      title: title !== "Untitled" ? title : cleanTitle(path.basename(abs)),
      meta,
      // a standalone .md's assets are relative to its own directory; a DB-row
      // page's leading exported property lines are dropped (shown from the CSV)
      blocks: rewriteAssetBlocks(
        stripExportPropertyBlock(relPath, blocks),
        path.posix.dirname(relPath)
      ),
      children: [],
    };
  }
  return null;
}

/** Create an OKF folder (mkdir -p, inside the root). writePage never creates
 * directories, so a caller building a new page tree calls this first. */
export function ensureFolder(relPath: string): void {
  fs.mkdirSync(resolveSafe(relPath), { recursive: true });
}

/** Does an OKF path exist on disk? */
export function nodeExists(relPath: string): boolean {
  try {
    return fs.existsSync(resolveSafe(relPath));
  } catch {
    return false;
  }
}

// ---- write-back: editing the app writes the OKF files ----------------------
export function writePage(relPath: string, title: string, meta: Frontmatter, blocks: ParsedBlock[]): void {
  // Row-as-page body persists to a sidecar md beside the CSV.
  const rp = parseRowPageRel(relPath);
  if (rp) {
    const sidecarAbs = resolveSafe(rowSidecarRel(rp.csvRelPath, rp.rowId));
    fs.mkdirSync(path.dirname(sidecarAbs), { recursive: true });
    const fm = serializeFrontmatter({ type: "Page", title, timestamp: new Date().toISOString(), ...meta });
    fs.writeFileSync(sidecarAbs, fm + blocksToMarkdown(title, blocks));
    return;
  }
  const abs = resolveSafe(relPath);
  const targetMd = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? path.join(abs, "index.md") : abs;
  const fm = serializeFrontmatter({ type: "Page", title, timestamp: new Date().toISOString(), ...meta });
  fs.writeFileSync(targetMd, fm + blocksToMarkdown(title, blocks));
}

/** Delete an OKF node. A row-page deletes only its sidecar body (the CSV row
 * stays); a file/folder is removed recursively. */
export function deleteNode(relPath: string): void {
  const rp = parseRowPageRel(relPath);
  if (rp) {
    const sidecarAbs = resolveSafe(rowSidecarRel(rp.csvRelPath, rp.rowId));
    if (fs.existsSync(sidecarAbs)) fs.rmSync(sidecarAbs);
    return;
  }
  const abs = resolveSafe(relPath);
  if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
}

// ---- identity bridge: ParsedBlock[] <-> the editor's Block[] shape ----------
export interface IncomingBlock {
  id?: string;
  type?: string;
  content?: Record<string, unknown>;
  position?: number;
}

/** ParsedBlock[] (file blocks) → Block[] (the shape /api/pages/[id]/blocks and
 * the editor use). Synthetic timestamps; parentBlockId is flat (null). */
export function parsedToBlocks(blocks: ParsedBlock[], pageId: string): Block[] {
  const now = new Date();
  return blocks.map((b, i) => ({
    id: b.id,
    pageId,
    type: b.type,
    content: b.content,
    parentBlockId: null,
    position: b.position ?? i + 1,
    createdAt: now,
    updatedAt: now,
  }));
}

/** The editor's incoming blocks → ParsedBlock[] for writing back to the file. */
export function blocksToParsed(incoming: IncomingBlock[]): ParsedBlock[] {
  return incoming.map((b, i) => ({
    id: b.id ?? `b${i}`,
    type: (b.type ?? "paragraph") as ParsedBlock["type"],
    content: (b.content ?? {}) as ParsedBlock["content"],
    position: b.position ?? i + 1,
  }));
}

/** A Postgres-Page-shaped object for an OKF node, so PageView renders it like
 * any page (the id is the OKF base64url id, not a UUID). */
export function okfSyntheticPage(p: {
  id: string;
  workspaceId: string;
  title: string;
  icon: string | null;
  parentPageId: string | null;
  position: number;
  kind?: NodeKind;
}): Page & { kind?: NodeKind } {
  const now = new Date();
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    parentPageId: p.parentPageId,
    teamspaceId: null,
    title: p.title,
    icon: p.icon,
    coverUrl: null,
    isArchived: false,
    isFavorite: false,
    position: p.position,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    // carry the OKF node kind so the unified sidebar can tell a file-backed
    // database (.csv) from a page (.md) — the main /api/pages consumer needs it.
    kind: p.kind,
  } as Page & { kind?: NodeKind };
}

/** Default icon for an OKF node kind. */
export function okfIcon(kind: string): string {
  return kind === "database" ? "🗂️" : "📄";
}

/** Index a database's per-row page files by their INTERNAL title. A Notion
 * export puts them in a sibling folder named after the database
 * (`<db title>/<row> <hash>.md`). We key by the file's `# ` heading, not the
 * filename, because exported filenames can be charset-mangled (Korean →
 * mojibake) while the file *content* stays correct UTF-8. Returns
 * Map<internalTitle, relPath>. */
function indexRowPageFiles(csvRelPath: string): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const csvAbs = resolveSafe(csvRelPath);
    const folderAbs = path.join(path.dirname(csvAbs), cleanTitle(path.basename(csvAbs)));
    if (fs.existsSync(folderAbs) && fs.statSync(folderAbs).isDirectory()) {
      for (const name of fs.readdirSync(folderAbs)) {
        if (!/\.md$/i.test(name)) continue;
        const abs = path.join(folderAbs, name);
        const { title } = parseMarkdown(fs.readFileSync(abs, "utf8"), "b");
        if (title && title !== "Untitled") m.set(title.trim(), rel(abs));
      }
    }
  } catch {
    // no sibling folder → rows fall back to a sidecar row-page
  }
  return m;
}

/** Shape a file-backed .csv database into the SAME { database, properties,
 * rows, views } snapshot the Postgres database engine returns, so the one
 * database view renders it (files are the backend, no parallel view). */
export async function okfDatabaseSnapshot(
  databaseId: string,
  relPath: string
): Promise<{ database: Database; properties: DbProperty[]; rows: DbRow[]; views: DbView[] } | null> {
  const node = readNode(relPath);
  if (!node || node.kind !== "database") return null;
  const now = new Date();
  const database = {
    id: databaseId,
    workspaceId: "",
    title: node.title,
    description: (await readDbMeta(relPath)).description ?? "",
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  } as Database;
  // A Notion export gives each database row its own page FILE in a sibling
  // folder named after the database: `<db title>/<row title> <hash>.md`. Link
  // each row to that real page so "open row" shows the actual body, not just
  // the CSV columns. The exported *view* CSV may not put the title column first
  // (e.g. a person column like "TL" leads), so parseCsvDatabase mis-marks col0
  // as the title. Detect the real title/link column = the property whose values
  // best match the page files' titles. Fall back to col0.
  const pageByTitle = indexRowPageFiles(relPath);
  let linkPropId =
    (node.properties.find((p) => p.type === "title") ?? node.properties[0])?.id ?? "";
  if (pageByTitle.size > 0) {
    let best = -1;
    for (const p of node.properties) {
      const hits = node.rows.filter((r) =>
        pageByTitle.has(String(r.values[p.id] ?? "").trim())
      ).length;
      if (hits > best) {
        best = hits;
        linkPropId = p.id;
      }
    }
  }
  // Promote the detected column to the title (primary), demote the mis-detected
  // one, and render the title first — like Notion.
  const properties = node.properties.map((p) => ({
    id: p.id,
    databaseId,
    name: p.name,
    type: p.id === linkPropId ? "title" : p.type === "title" ? "text" : p.type,
    config: p.config,
    position: p.position,
    createdAt: now,
  })) as DbProperty[];
  properties.sort((a, b) =>
    a.type === "title" ? -1 : b.type === "title" ? 1 : a.position - b.position
  );
  const rows = node.rows.map((r) => {
    const key = linkPropId ? String(r.values[linkPropId] ?? "").trim() : "";
    const pageRel = (key && pageByTitle.get(key)) || rowPageRel(relPath, r.id);
    return {
      id: r.id,
      databaseId,
      values: { ...r.values, __page: encodeId(pageRel) },
      position: r.position,
      parentRowId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    };
  }) as DbRow[];

  // ---- merge the Postgres schema overlay: declared types, authored options,
  // positions. Overridden columns re-derive their row values from the RAW csv
  // strings (name → authored option id, Number, date, …) so authored option
  // ids — not the inference's positional ids — flow to the client.
  const dbMeta = await readDbMeta(relPath);
  if (dbMeta.props && Object.keys(dbMeta.props).length) {
    let rawGrid: string[][] | null = null;
    const rawCell = (ri: number, ci: number): string => {
      rawGrid ??= parseCsv(fs.readFileSync(resolveSafe(dataCsvRel(relPath)), "utf8"));
      return (rawGrid[ri + 1]?.[ci] ?? "").trim();
    };

    for (const p of properties) {
      const ov = dbMeta.props[p.name.trim()];
      if (!ov || p.type === "title") continue;
      const targetType = (ov.type as PropertyType) ?? p.type;
      const authoredCfg = ov.config;
      if ((ov.type && ov.type !== p.type) || authoredCfg?.options) {
        const ci = Number(p.id.replace(/^col/, ""));
        const options: SelectOption[] = [...(authoredCfg?.options ?? [])];
        const optIdByName = new Map(options.map((o) => [o.name, o.id]));
        const optionFor = (nameStr: string): string => {
          let id = optIdByName.get(nameStr);
          if (!id) {
            // name-derived id/color: stable across row insertions/deletions
            id = optionIdFor(nameStr);
            options.push({ id, name: nameStr, color: optionColorFor(nameStr) });
            optIdByName.set(nameStr, id);
          }
          return id;
        };
        for (const r of rows) {
          const raw = rawCell(Number(r.id.replace(/^row/, "")), ci);
          let v: unknown;
          if (raw) {
            switch (targetType) {
              case "number": {
                const n = Number(raw.replace(/%/g, "").replace(/,/g, ""));
                v = isNaN(n) ? undefined : n;
                break;
              }
              case "checkbox":
                v = /^(true|yes|checked|✓)$/i.test(raw);
                break;
              case "date":
                v = parseDateCell(raw);
                break;
              case "select":
              case "status":
                v = optionFor(raw);
                break;
              case "multi_select":
                v = multiTokens(raw).map(optionFor);
                break;
              default:
                v = raw;
            }
          }
          const vals = r.values as Record<string, unknown>;
          if (v === undefined || v === "") delete vals[p.id];
          else vals[p.id] = v;
        }
        const selectish =
          targetType === "select" || targetType === "status" || targetType === "multi_select";
        p.config = { ...(authoredCfg ?? p.config), ...(selectish ? { options } : {}) };
      } else if (authoredCfg) {
        p.config = authoredCfg;
      }
      p.type = targetType;
      if (typeof ov.position === "number") p.position = ov.position;
    }
    properties.sort((a, b) =>
      a.type === "title" ? -1 : b.type === "title" ? 1 : a.position - b.position
    );
  }

  const metaViews = (dbMeta.views ?? []).map((v) => ({ ...v, databaseId })) as DbView[];
  const views = metaViews.length
    ? metaViews.sort((a, b) => a.position - b.position)
    : ([
        { id: "okf-table", databaseId, name: "Table", type: "table", config: {}, position: 1 },
      ] as DbView[]);
  return { database, properties, rows, views };
}

/** Update one CSV cell in place. rowId=`row<i>`, propId=`col<j>` (path ids). */
export function writeDbCell(relPath: string, rowId: string, propId: string, value: string): void {
  if (!isCsv(relPath)) throw new Error("not a database");
  const abs = resolveSafe(dataCsvRel(relPath));
  const grid = parseCsv(fs.readFileSync(abs, "utf8"));
  const ri = Number(rowId.replace(/^row/, ""));
  const ci = Number(propId.replace(/^col/, ""));
  if (!Number.isInteger(ri) || !Number.isInteger(ci)) throw new Error("bad cell id");
  const gridRow = grid[ri + 1]; // +1 for header
  if (!gridRow) throw new Error("row out of range");
  while (gridRow.length <= ci) gridRow.push("");
  gridRow[ci] = value;
  fs.writeFileSync(abs, toCsv(grid));
}

/** Append an empty row to a CSV database. Returns the new row's path id. */
export function writeDbAddRow(relPath: string): string {
  if (!isCsv(relPath)) throw new Error("not a database");
  const abs = resolveSafe(dataCsvRel(relPath));
  const grid = parseCsv(fs.readFileSync(abs, "utf8"));
  const cols = grid[0]?.length ?? 1;
  // a CSV row *is* its cells — seed the title (col 0) so the row persists
  // (a fully-empty row is indistinguishable from the trailing-newline artifact).
  const newRow = Array(cols).fill("");
  newRow[0] = "Untitled";
  grid.push(newRow);
  fs.writeFileSync(abs, toCsv(grid));
  return `row${grid.length - 2}`;
}

// ===========================================================================
// OKF schema overlay — the schema a bare CSV can't hold (declared property
// types, authored select options, column positions, extra views). The md/csv
// folder tree stays the canonical CONTENT store; schema operations the files
// can't express persist in Postgres (okf_db_meta), keyed by (content root,
// csv rel path). Prop keys are CSV header NAMES so keys survive column-index
// shifts; renames migrate keys.
// ===========================================================================

export interface DbMetaProp {
  type?: string;
  config?: PropertyConfig;
  position?: number;
}
export interface DbMetaView {
  id: string;
  name: string;
  type: string;
  config: ViewConfig;
  position: number;
}
export interface DbMeta {
  props?: Record<string, DbMetaProp>;
  views?: DbMetaView[];
  /** editable text under the DB title */
  description?: string;
}

export async function readDbMeta(rel: string): Promise<DbMeta> {
  const [row] = await db
    .select()
    .from(okfDbMeta)
    .where(and(eq(okfDbMeta.root, okfRoot()), eq(okfDbMeta.path, rel)))
    .limit(1);
  return (row?.meta as DbMeta) ?? {};
}
export async function writeDbMeta(rel: string, meta: DbMeta): Promise<void> {
  await db
    .insert(okfDbMeta)
    .values({
      root: okfRoot(),
      path: rel,
      meta: meta as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [okfDbMeta.root, okfDbMeta.path],
      set: { meta: meta as Record<string, unknown>, updatedAt: new Date() },
    });
}

function readGrid(rel: string): string[][] {
  if (!isCsv(rel)) throw new Error("not a database");
  return parseCsv(fs.readFileSync(resolveSafe(dataCsvRel(rel)), "utf8"));
}
function writeGrid(rel: string, grid: string[][]): void {
  fs.writeFileSync(resolveSafe(dataCsvRel(rel)), toCsv(grid));
}
function colIndex(propId: string): number {
  const ci = Number(propId.replace(/^col/, ""));
  if (!Number.isInteger(ci) || ci < 0) throw new Error("bad property id");
  return ci;
}

/** Add a column: header + empty cells; declared type/config go to the overlay. */
export async function writeDbAddColumn(
  rel: string,
  name: string,
  type?: string,
  config?: PropertyConfig
): Promise<{ propId: string; name: string; position: number }> {
  const grid = readGrid(rel);
  if (!grid.length) grid.push([]);
  const header = grid[0];
  const base = (name || "Property").trim() || "Property";
  let final = base;
  let n = 2;
  while (header.some((h) => h.trim() === final)) final = `${base} ${n++}`;
  header.push(final);
  for (let i = 1; i < grid.length; i++) grid[i].push("");
  writeGrid(rel, grid);
  if ((type && type !== "text") || config) {
    const meta = await readDbMeta(rel);
    meta.props = {
      ...(meta.props ?? {}),
      [final]: {
        ...(type && type !== "text" ? { type } : {}),
        ...(config ? { config } : {}),
      },
    };
    await writeDbMeta(rel, meta);
  }
  return { propId: `col${header.length - 1}`, name: final, position: header.length };
}

/** Rename a column header (overlay keys follow the name). */
export async function writeDbRenameColumn(
  rel: string,
  propId: string,
  newName: string
): Promise<void> {
  const grid = readGrid(rel);
  const ci = colIndex(propId);
  const old = grid[0]?.[ci];
  if (old === undefined) throw new Error("column out of range");
  grid[0][ci] = newName;
  writeGrid(rel, grid);
  const meta = await readDbMeta(rel);
  const oldKey = old.trim();
  const newKey = newName.trim();
  if (meta.props && oldKey in meta.props && oldKey !== newKey) {
    meta.props[newKey] = meta.props[oldKey];
    delete meta.props[oldKey];
    await writeDbMeta(rel, meta);
  }
}

/** Delete a column from every row (and its overlay annotation). Positional
 * `col{N}` ids SHIFT on splice, so every saved view config is remapped —
 * otherwise a filter/sort/group-by on "col3" silently retargets the column
 * that used to be col4. Rules on the deleted column itself are dropped. */
export async function writeDbDeleteColumn(rel: string, propId: string): Promise<void> {
  const grid = readGrid(rel);
  const ci = colIndex(propId);
  const old = grid[0]?.[ci];
  if (old === undefined) throw new Error("column out of range");
  for (const row of grid) row.splice(ci, 1);
  writeGrid(rel, grid);

  const meta = await readDbMeta(rel);
  let dirty = false;
  if (meta.props && old.trim() in meta.props) {
    delete meta.props[old.trim()];
    dirty = true;
  }
  const remap = (id: unknown): string | undefined => {
    if (typeof id !== "string" || !/^col\d+$/.test(id)) return id as string | undefined;
    const n = Number(id.slice(3));
    if (n === ci) return undefined; // referenced the deleted column
    return n > ci ? `col${n - 1}` : id;
  };
  for (const v of meta.views ?? []) {
    const c = v.config as Record<string, unknown>;
    if (Array.isArray(c.filters)) {
      c.filters = (c.filters as { propertyId: string }[])
        .map((f) => ({ ...f, propertyId: remap(f.propertyId) }))
        .filter((f) => f.propertyId !== undefined);
      dirty = true;
    }
    if (Array.isArray(c.sorts)) {
      c.sorts = (c.sorts as { propertyId: string }[])
        .map((s) => ({ ...s, propertyId: remap(s.propertyId) }))
        .filter((s) => s.propertyId !== undefined);
      dirty = true;
    }
    for (const key of ["groupByPropertyId", "calendarDatePropertyId"] as const) {
      if (typeof c[key] === "string") {
        c[key] = remap(c[key]);
        dirty = true;
      }
    }
    if (Array.isArray(c.hiddenProperties)) {
      c.hiddenProperties = (c.hiddenProperties as string[])
        .map(remap)
        .filter((x): x is string => x !== undefined);
      dirty = true;
    }
    if (c.calcs && typeof c.calcs === "object") {
      const next: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(c.calcs as Record<string, unknown>)) {
        const nk = remap(k);
        if (nk !== undefined) next[nk] = val;
      }
      c.calcs = next;
      dirty = true;
    }
  }
  if (dirty) await writeDbMeta(rel, meta);
}

/** Update a column's declared type/config/position in the overlay. */
export async function okfSetPropMeta(
  rel: string,
  propId: string,
  patch: { type?: string; config?: PropertyConfig; position?: number }
): Promise<void> {
  const grid = readGrid(rel);
  const name = grid[0]?.[colIndex(propId)]?.trim();
  if (!name) throw new Error("column out of range");
  const meta = await readDbMeta(rel);
  const cur = meta.props?.[name] ?? {};
  meta.props = {
    ...(meta.props ?? {}),
    [name]: {
      ...cur,
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
    },
  };
  await writeDbMeta(rel, meta);
}

/** Move a CSV row to a fractional 1-based position ("between floor and ceil",
 * the same ±0.5 convention as column reorder). Physical row order IS the
 * manual sort order; row ids shift, so clients refetch afterwards. */
export function writeDbMoveRow(rel: string, rowId: string, newPos: number): void {
  const grid = readGrid(rel);
  const ri = Number(rowId.replace(/^row/, ""));
  if (!Number.isInteger(ri) || !grid[ri + 1]) throw new Error("row out of range");
  const [moved] = grid.splice(ri + 1, 1);
  let idx = Math.ceil(newPos - 1); // number of data rows before the target slot
  if (idx > ri) idx -= 1; // removal shifted everything after ri down by one
  idx = Math.max(0, Math.min(grid.length - 1, idx));
  grid.splice(idx + 1, 0, moved);
  writeGrid(rel, grid);
}

/** Delete a CSV row (later row ids shift — clients refetch after deletes). */
export function writeDbDeleteRow(rel: string, rowId: string): void {
  const grid = readGrid(rel);
  const ri = Number(rowId.replace(/^row/, ""));
  if (!Number.isInteger(ri) || !grid[ri + 1]) throw new Error("row out of range");
  grid.splice(ri + 1, 1);
  writeGrid(rel, grid);
}

const OKF_DEFAULT_VIEW: DbMetaView = {
  id: "okf-table",
  name: "Table",
  type: "table",
  config: {},
  position: 1,
};

/** Add a view. The first authored view materializes the default table first so
 * the original table stays a tab. */
export async function okfAddView(
  rel: string,
  v: { name?: string; type: string; config?: ViewConfig }
): Promise<DbMetaView> {
  const meta = await readDbMeta(rel);
  const views = meta.views?.length ? meta.views : [{ ...OKF_DEFAULT_VIEW }];
  const view: DbMetaView = {
    id: randomUUID(),
    name: v.name || v.type.charAt(0).toUpperCase() + v.type.slice(1),
    type: v.type,
    config: v.config ?? {},
    position: views.length + 1,
  };
  views.push(view);
  meta.views = views;
  await writeDbMeta(rel, meta);
  return view;
}

/** Delete a view from the overlay (the last view falls back to the default table). */
export async function okfDeleteView(rel: string, viewId: string): Promise<void> {
  const meta = await readDbMeta(rel);
  if (!meta.views?.length) return;
  meta.views = meta.views.filter((v) => v.id !== viewId);
  await writeDbMeta(rel, meta);
}

/** Patch a view: config (filters / sorts / group-by …) and/or name. */
export async function okfPatchView(
  rel: string,
  viewId: string,
  patch: { config?: ViewConfig; name?: string }
): Promise<DbMetaView | null> {
  const meta = await readDbMeta(rel);
  const views = meta.views?.length ? meta.views : [{ ...OKF_DEFAULT_VIEW }];
  const view = views.find((x) => x.id === viewId);
  if (!view) return null;
  if (patch.config !== undefined) view.config = patch.config;
  if (typeof patch.name === "string" && patch.name.trim()) view.name = patch.name.trim();
  meta.views = views;
  await writeDbMeta(rel, meta);
  return view;
}

/** If this OKF page is a database ROW's page — a sidecar (`csv#rowN`) or an
 * exported `<db title>/<row title> <hash>.md` — return its db + row so the
 * full-page view can render the row's editable properties (Notion). */
export async function okfRowRefForPage(
  rel: string
): Promise<{ databaseId: string; rowId: string } | null> {
  const rp = parseRowPageRel(rel);
  if (rp) return { databaseId: encodeId(rp.csvRelPath), rowId: rp.rowId };
  if (!/\.md$/i.test(rel)) return null;
  const dir = path.posix.dirname(rel);
  if (!dir || dir === ".") return null;
  const folderName = path.posix.basename(dir);
  const parentRel = path.posix.dirname(dir);
  try {
    const parentAbs = resolveSafe(parentRel === "." ? "" : parentRel);
    for (const name of fs.readdirSync(parentAbs)) {
      if (!isCsv(name) || cleanTitle(name) !== folderName) continue;
      const csvRel = parentRel === "." ? name : `${parentRel}/${name}`;
      const databaseId = encodeId(csvRel);
      const snap = await okfDatabaseSnapshot(databaseId, csvRel);
      const target = encodeId(rel);
      const row = snap?.rows.find((r) => r.values["__page"] === target);
      return row ? { databaseId, rowId: row.id } : null;
    }
  } catch {
    /* unreadable parent → not a row page */
  }
  return null;
}

// ---- structural ops used by the MCP surface: move / duplicate / create-db --

/** Move a page/database/folder node under a new parent folder (root = ""). A
 * database ROW page (`csv#rowN`) has no movable file. Returns the new rel id. */
export function moveNode(relPath: string, newParentRel: string): string {
  if (parseRowPageRel(relPath)) throw new Error("cannot move a database row page");
  const abs = resolveSafe(relPath);
  if (!fs.existsSync(abs)) throw new Error("node not found");
  const parentAbs = resolveSafe(newParentRel || "");
  if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory())
    throw new Error("target parent is not a folder");
  const base = path.basename(abs);
  const destRel = newParentRel ? `${newParentRel}/${base}` : base;
  if (resolveSafe(destRel) === abs) return relPath;
  if (fs.existsSync(resolveSafe(destRel))) throw new Error("a node with that name already exists in the target");
  fs.renameSync(abs, resolveSafe(destRel));
  return destRel;
}

/** Duplicate a page/database/folder node beside itself ("<name> (copy)"). */
export function duplicateNode(relPath: string): string {
  if (parseRowPageRel(relPath)) throw new Error("cannot duplicate a database row page");
  const abs = resolveSafe(relPath);
  if (!fs.existsSync(abs)) throw new Error("node not found");
  const dir = path.posix.dirname(relPath);
  const ext = /\.(md|csv)$/i.exec(relPath)?.[0] ?? "";
  const stem = path.basename(relPath, ext);
  let destRel = "";
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? " (copy)" : ` (copy ${n})`}${ext}`;
    destRel = dir === "." ? name : `${dir}/${name}`;
    if (!fs.existsSync(resolveSafe(destRel))) break;
  }
  fs.cpSync(abs, resolveSafe(destRel), { recursive: true });
  return destRel;
}

/** Create a new CSV database (columns[0] = title). Declared non-text types and
 * select options persist to the okf_db_meta overlay. Returns the new rel path. */
export async function createDatabase(
  parentRel: string,
  title: string,
  columns: { name: string; type?: string; options?: string[] }[]
): Promise<string> {
  const cols = columns.length ? columns : [{ name: "Name" }];
  const header: string[] = [];
  for (const c of cols) {
    const base = (c.name || "Property").trim() || "Property";
    let f = base;
    for (let k = 2; header.includes(f); k++) f = `${base} ${k}`;
    header.push(f);
  }
  const fileName = `${cleanTitle(title) || "Untitled"}.csv`;
  const destRel = parentRel ? `${parentRel}/${fileName}` : fileName;
  if (parentRel) fs.mkdirSync(resolveSafe(parentRel), { recursive: true });
  if (fs.existsSync(resolveSafe(destRel))) throw new Error("a database with that name already exists");
  fs.writeFileSync(resolveSafe(destRel), toCsv([header]));
  // overlay: declared types/options for the non-title columns
  const props: Record<string, DbMetaProp> = {};
  cols.forEach((c, i) => {
    if (i === 0) return; // col0 is the auto-detected title
    const type = c.type && c.type !== "text" ? c.type : undefined;
    const config = c.options?.length
      ? { options: c.options.map((name) => ({ id: optionIdFor(name), name, color: optionColorFor(name) })) }
      : undefined;
    if (type || config) props[header[i]] = { ...(type ? { type } : {}), ...(config ? { config } : {}) };
  });
  if (Object.keys(props).length) await writeDbMeta(destRel, { props });
  return destRel;
}

/** Serialize an editor cell value to the CSV string a column stores. */
export function okfSerializeCell(prop: DbProperty, value: unknown): string {
  if (value === null || value === undefined) return "";
  const optName = (id: unknown) =>
    prop.config.options?.find((o) => o.id === id)?.name ?? String(id);
  if (prop.type === "select" || prop.type === "status") return optName(value);
  if (prop.type === "multi_select" && Array.isArray(value))
    return value.map(optName).join(", ");
  if (prop.type === "date" && typeof value === "object") {
    const d = value as { start?: string; end?: string };
    return `${d.start ?? ""}${d.end ? ` → ${d.end}` : ""}`;
  }
  return String(value);
}
