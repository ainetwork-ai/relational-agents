import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  listPages,
  readNode,
  writePage,
  moveNode,
  duplicateNode,
  createDatabase,
  okfDatabaseSnapshot,
  readDbMeta,
  writeDbMeta,
  writeDbAddColumn,
  writeDbRenameColumn,
  writeDbDeleteColumn,
  okfAddView,
  okfPatchView,
  encodeId,
  decodeId,
  isOkfId,
} from "@/lib/okf-store";
import { parseMarkdown, blocksToMarkdown, type Frontmatter } from "@/lib/notion-parse";
import { okfGateFor, type OkfGate } from "@/lib/okf-acl";
import { getSession } from "@/lib/auth/session";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { db } from "@/lib/db";
import {
  agentAccessTokens,
  comments,
  users,
  workspaceMembers,
  teamspaces,
  type ViewFilter,
  type ViewSort,
  type ViewConfig,
} from "@/lib/db/schema";

// SSE streaming — must run on the Node.js runtime, never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP server exposed as a Next.js Route Handler over Streamable HTTP.
 * Endpoint: /api/mcp  (GET = server→client stream, POST = messages, DELETE = end session)
 *
 * GOAL: functional parity with the official hosted Notion MCP server
 * (mcp.notion.com), adapted to this app's canonical OKF file store (folder=DB).
 * Tool names follow Notion's `notion-*` convention and content flows as
 * Notion-flavored Markdown, matching the official server's agent-first design.
 *
 * Auth (required): OKF files hold participant-only content, so this surface
 * passes the okf_acl gate too. Three identities: (1) Bearer <agent token> =
 * that agent, (2) Bearer <MCP_SERVICE_TOKEN> = service (public read-only),
 * (3) session cookie = that user.
 */

// ── request-scoped identity (handler is built once → AsyncLocalStorage) ──────
type Identity = { userId: string; label: "agent" | "service" | "session" };
const identity = new AsyncLocalStorage<Identity>();
const who = (): Identity => identity.getStore() ?? { userId: "", label: "service" };
const currentUserId = () => who().userId;
const gateFor = (): Promise<OkfGate> => okfGateFor(currentUserId());

/** Mutations and identity-bound reads need a real person/agent, not the public
 *  service token. Throw → surfaced as an MCP tool error. */
function requireUser(): string {
  const id = currentUserId();
  if (!id) throw new Error("This action requires a user or agent identity (not the public service token).");
  return id;
}

async function resolveIdentity(req: Request): Promise<Identity | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const [row] = await db.select().from(agentAccessTokens).where(eq(agentAccessTokens.token, bearer));
    if (row) return { userId: row.agentUserId, label: "agent" };
    const service = process.env.MCP_SERVICE_TOKEN;
    if (service && bearer === service) return { userId: "", label: "service" };
    return null; // unknown token → reject (never silently fall back to session)
  }
  const session = await getSession().catch(() => null);
  if (session?.userId) return { userId: session.userId, label: "session" };
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────
const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

/** OKF id → rel path, validated. Throws for non-OKF ids. */
function relOf(id: string): string {
  if (!isOkfId(id)) throw new Error(`Not a valid Notion entity id: ${id}`);
  return decodeId(id);
}

/** Resolve a property reference (its colN id OR its display name) to a colN id. */
function resolveProp(properties: { id: string; name: string }[], ref: string): string | null {
  const byId = properties.find((p) => p.id === ref);
  if (byId) return byId.id;
  const byName = properties.find((p) => p.name.toLowerCase() === ref.toLowerCase());
  return byName ? byName.id : null;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(cellText).join(", ");
  if (typeof v === "object") {
    const d = v as { start?: string; end?: string };
    if (d.start || d.end) return `${d.start ?? ""}${d.end ? ` → ${d.end}` : ""}`;
    return JSON.stringify(v);
  }
  return String(v);
}

function matchFilter(cell: unknown, op: string, value: unknown): boolean {
  const s = cellText(cell).toLowerCase();
  const v = value === undefined ? "" : cellText(value).toLowerCase();
  const nums = () => [parseFloat(cellText(cell)), parseFloat(cellText(value))] as const;
  switch (op) {
    case "equals": return s === v;
    case "not_equals": return s !== v;
    case "contains": return s.includes(v);
    case "not_contains": return !s.includes(v);
    case "starts_with": return s.startsWith(v);
    case "ends_with": return s.endsWith(v);
    case "is_empty": return s === "";
    case "not_empty": return s !== "";
    case "gt": { const [a, b] = nums(); return a > b; }
    case "gte": { const [a, b] = nums(); return a >= b; }
    case "lt": { const [a, b] = nums(); return a < b; }
    case "lte": { const [a, b] = nums(); return a <= b; }
    default: return true;
  }
}

type Snapshot = NonNullable<Awaited<ReturnType<typeof okfDatabaseSnapshot>>>;

/** Apply structured filters + sorts to a snapshot's rows (in-memory). */
function queryRows(
  snap: Snapshot,
  filters: { property: string; op: string; value?: unknown }[],
  sorts: { property: string; direction?: "asc" | "desc" }[],
  conjunction: "and" | "or",
  pageSize: number
) {
  let rows = snap.rows.slice();
  if (filters.length) {
    rows = rows.filter((r) => {
      const tests = filters.map((f) => {
        const pid = resolveProp(snap.properties, f.property);
        return pid ? matchFilter(r.values[pid], f.op, f.value) : true;
      });
      return conjunction === "or" ? tests.some(Boolean) : tests.every(Boolean);
    });
  }
  for (const s of [...sorts].reverse()) {
    const pid = resolveProp(snap.properties, s.property);
    if (!pid) continue;
    const dir = s.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => cellText(a.values[pid]).localeCompare(cellText(b.values[pid])) * dir);
  }
  return rows.slice(0, pageSize);
}

/** Render a database snapshot's rows as a Notion-flavored Markdown table. */
function rowsToMarkdown(snap: Snapshot, rows: Snapshot["rows"], cols?: Snapshot["properties"]): string {
  const props = cols ?? snap.properties;
  const head = `| ${props.map((p) => p.name).join(" | ")} |`;
  const sep = `| ${props.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (r) => `| ${props.map((p) => cellText(r.values[p.id]).replace(/\|/g, "\\|")).join(" | ")} |`
  );
  return [head, sep, ...body].join("\n");
}

/** Parse a practical subset of SQL SELECT against a single data source:
 *  SELECT * | col[, col] ... [WHERE cond [AND|OR cond]...] [ORDER BY col [ASC|DESC]...] [LIMIT n]
 *  Conditions: col {= | != | <> | > | < | >= | <= | LIKE | NOT LIKE} 'value'|number.
 *  Column names are matched by display name or colN id (case-insensitive). */
function parseSql(sql: string): {
  columns: string[] | "*";
  filters: { property: string; op: string; value: unknown }[];
  conjunction: "and" | "or";
  sorts: { property: string; direction: "asc" | "desc" }[];
  limit: number | null;
} {
  const src = sql.trim().replace(/;+\s*$/, "");
  const m = /^select\s+([\s\S]+?)\s+from\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[^\s]+)([\s\S]*)$/i.exec(src);
  if (!m) throw new Error("Unsupported SQL: expected SELECT ... FROM ...");
  const cols = m[1].trim();
  const columns: string[] | "*" =
    cols === "*" ? "*" : cols.split(",").map((c) => c.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);
  let rest = m[2].trim();

  let limit: number | null = null;
  const lm = /\blimit\s+(\d+)\s*$/i.exec(rest);
  if (lm) { limit = parseInt(lm[1], 10); rest = rest.slice(0, lm.index).trim(); }

  const sorts: { property: string; direction: "asc" | "desc" }[] = [];
  const om = /\border\s+by\s+([\s\S]+)$/i.exec(rest);
  if (om) {
    for (const part of om[1].split(",")) {
      const sm = /^\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+))\s*(asc|desc)?\s*$/i.exec(part);
      if (sm) sorts.push({ property: sm[1] ?? sm[2] ?? sm[3] ?? sm[4], direction: (sm[5]?.toLowerCase() === "desc" ? "desc" : "asc") });
    }
    rest = rest.slice(0, om.index).trim();
  }

  const filters: { property: string; op: string; value: unknown }[] = [];
  let conjunction: "and" | "or" = "and";
  const wm = /^\s*where\s+([\s\S]+)$/i.exec(rest);
  if (wm) {
    const clause = wm[1];
    if (/\bor\b/i.test(clause) && !/\band\b/i.test(clause)) conjunction = "or";
    const conds = clause.split(/\s+(?:and|or)\s+/i);
    for (const c of conds) {
      const cm = /^\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+))\s*(=|!=|<>|>=|<=|>|<|not\s+like|like)\s*([\s\S]+?)\s*$/i.exec(c);
      if (!cm) throw new Error(`Unsupported WHERE condition: ${c.trim()}`);
      const property = cm[1] ?? cm[2] ?? cm[3] ?? cm[4];
      const rawOp = cm[5].toLowerCase().replace(/\s+/g, " ");
      let raw = cm[6].trim().replace(/^["']|["']$/g, "");
      let op: string;
      if (rawOp === "like" || rawOp === "not like") {
        const lead = raw.startsWith("%"), tail = raw.endsWith("%");
        raw = raw.replace(/^%|%$/g, "");
        const base = lead && tail ? "contains" : tail ? "starts_with" : lead ? "ends_with" : "equals";
        op = rawOp === "not like" ? (base === "contains" ? "not_contains" : "not_equals") : base;
      } else {
        op = { "=": "equals", "!=": "not_equals", "<>": "not_equals", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte" }[rawOp]!;
      }
      filters.push({ property, op, value: raw });
    }
  }
  return { columns, filters, conjunction, sorts, limit };
}

/** Render any OKF node as Notion-flavored Markdown (the `notion-fetch` shape). */
async function renderNode(id: string): Promise<string> {
  const node = readNode(relOf(id));
  if (!node) throw new Error(`Entity not found: ${id}`);
  if (node.kind === "database") {
    const snap = await okfDatabaseSnapshot(id, relOf(id));
    const propLines = (snap?.properties ?? node.properties).map((p) => `- **${p.name}** (${p.type})`);
    const preview = snap ? rowsToMarkdown(snap, snap.rows.slice(0, 25)) : "";
    return [
      `# ${node.title}`,
      ``,
      `_Database — ${node.totalRows ?? node.rows.length} row(s)_`,
      ``,
      `## Properties`,
      ...propLines,
      ``,
      `## Rows (first 25)`,
      preview,
    ].join("\n");
  }
  // page or row-as-page
  const fm = node.meta && Object.keys(node.meta).length
    ? "> " + Object.entries(node.meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ") + "\n\n"
    : "";
  return fm + blocksToMarkdown(node.title, node.blocks ?? []);
}

/** A slug-safe filename for a page title. */
const slugFile = (title: string) => `${(title || "Untitled").replace(/[/\\]/g, "-").trim() || "Untitled"}.md`;

/** Parent id → the OKF folder rel that new children go under ("" = root). */
function parentRelOf(parentId?: string): string {
  if (!parentId) return "";
  const rel = relOf(parentId);
  const node = readNode(rel);
  if (node?.kind === "database") throw new Error("cannot create a page inside a database; add a row instead");
  // a leaf .md has no children dir → create the sibling in its containing folder
  return /\.md$/i.test(rel) ? rel.replace(/\/[^/]+\.md$/i, "").replace(/[^/]+\.md$/i, "") : rel;
}

// ── async-task registry (parity with notion-get-async-task) ─────────────────
type Task = { id: string; status: "completed" | "failed"; summary: string; resultId?: string; error?: string };
const tasks = new Map<string, Task>();
function completedTask(summary: string, resultId?: string): Task {
  const t: Task = { id: randomUUID(), status: "completed", summary, resultId };
  tasks.set(t.id, t);
  return t;
}

const handler = createMcpHandler(
  (server) => {
    // ── health ──────────────────────────────────────────────────────────
    server.tool(
      "ping",
      "Health check — returns 'pong' plus an optional echo.",
      { message: z.string().optional() },
      async ({ message }) => ok(`pong${message ? ` ${message}` : ""}`)
    );

    // ── notion-search ─────────────────────────────────────────────────────
    server.tool(
      "notion-search",
      "Search pages and databases across the workspace by title and body text. Returns matching entities with id, title, kind and a snippet.",
      {
        query: z.string().describe("keywords to search for"),
        filter: z.enum(["page", "database"]).optional().describe("restrict to pages or databases"),
        limit: z.number().int().min(1).max(50).optional(),
      },
      async ({ query, filter, limit }) => {
        const gate = await gateFor();
        const q = query.trim().toLowerCase();
        const cap = limit ?? 20;
        const hits: { id: string; title: string; kind: string; snippet: string }[] = [];
        for (const p of listPages()) {
          if (p.isArchived || !gate.canReadId(p.id)) continue;
          if (filter === "page" && p.kind === "database") continue;
          if (filter === "database" && p.kind !== "database") continue;
          let snippet = "";
          let match = q === "" || p.title.toLowerCase().includes(q);
          if (!match && p.kind !== "database") {
            const node = readNode(decodeId(p.id));
            const body =
              node && node.kind !== "database"
                ? (node.blocks ?? []).map((b) => b.content?.text ?? "").join(" ")
                : "";
            const at = body.toLowerCase().indexOf(q);
            if (at >= 0) { match = true; snippet = body.slice(Math.max(0, at - 40), at + 60).trim(); }
          }
          if (match) {
            hits.push({ id: p.id, title: p.title, kind: p.kind, snippet });
            if (hits.length >= cap) break;
          }
        }
        return json({ count: hits.length, results: hits });
      }
    );

    // ── notion-fetch ───────────────────────────────────────────────────────
    server.tool(
      "notion-fetch",
      "Retrieve a Notion entity (page, database, or row) by id as Notion-flavored Markdown. Pass id='self' for the current identity + workspace.",
      { id: z.string().describe("entity id from search/list, or 'self'") },
      async ({ id }) => {
        if (id === "self") {
          const me = who();
          let name: string | undefined;
          if (me.userId) {
            const [u] = await db.select().from(users).where(eq(users.id, me.userId));
            name = u?.displayName;
          }
          const workspaceId = me.userId ? await getDefaultWorkspaceId(me.userId) : null;
          return json({ identity: me.label, userId: me.userId || null, displayName: name ?? null, workspaceId });
        }
        const gate = await gateFor();
        if (!gate.canReadId(id)) return err(`Entity not found: ${id}`);
        try {
          return ok(await renderNode(id));
        } catch (e) {
          return err(String((e as Error).message));
        }
      }
    );

    // ── notion-create-pages ─────────────────────────────────────────────────
    server.tool(
      "notion-create-pages",
      "Create one or more pages. Each page has a title, optional parent id, optional Markdown content, and optional icon (emoji).",
      {
        pages: z
          .array(
            z.object({
              title: z.string(),
              parent_id: z.string().optional().describe("parent page/folder id; omit for workspace root"),
              content: z.string().optional().describe("Notion-flavored Markdown body"),
              icon: z.string().optional().describe("emoji icon"),
            })
          )
          .min(1),
      },
      async ({ pages }) => {
        requireUser();
        const gate = await gateFor();
        const created: { id: string; title: string }[] = [];
        for (const p of pages) {
          const parentRel = parentRelOf(p.parent_id);
          if (p.parent_id && !gate.canReadId(p.parent_id)) return err(`Parent not accessible: ${p.parent_id}`);
          let rel = parentRel ? `${parentRel}/${slugFile(p.title)}` : slugFile(p.title);
          for (let n = 2; readNode(rel); n++) {
            const name = slugFile(`${p.title} ${n}`);
            rel = parentRel ? `${parentRel}/${name}` : name;
          }
          const { blocks } = p.content ? parseMarkdown(p.content, "b", { noTitle: true }) : { blocks: [] };
          const meta: Frontmatter = p.icon ? { icon: p.icon } : {};
          writePage(rel, p.title, meta, blocks);
          created.push({ id: encodeId(rel), title: p.title });
        }
        return json({ created });
      }
    );

    // ── notion-update-page ──────────────────────────────────────────────────
    server.tool(
      "notion-update-page",
      "Update a page. mode='replace' overwrites the body with new Markdown; mode='find_replace' does a text substitution. Optionally change title or icon.",
      {
        id: z.string(),
        mode: z.enum(["replace", "find_replace"]).optional(),
        content: z.string().optional().describe("new Markdown body (replace mode)"),
        find: z.string().optional(),
        replace: z.string().optional(),
        title: z.string().optional(),
        icon: z.string().optional(),
      },
      async ({ id, mode, content, find, replace, title, icon }) => {
        requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(id)) return err(`Entity not found: ${id}`);
        const rel = relOf(id);
        const node = readNode(rel);
        if (!node || node.kind === "database") return err("Target is not a page.");
        const newTitle = title ?? node.title;
        const meta: Frontmatter = { ...(node.meta ?? {}) };
        if (icon) meta.icon = icon;
        let blocks = node.blocks ?? [];
        if ((mode ?? (content !== undefined ? "replace" : "find_replace")) === "replace") {
          if (content === undefined) return err("replace mode needs `content`.");
          blocks = parseMarkdown(content, "b", { noTitle: true }).blocks;
        } else if (find !== undefined) {
          const md = blocksToMarkdown(newTitle, blocks);
          const swapped = md.split(find).join(replace ?? "");
          // blocksToMarkdown prepends "# <title>", so consume it as the title
          // again (noTitle would duplicate it as a heading block in the body)
          blocks = parseMarkdown(swapped, "b").blocks;
        }
        writePage(rel, newTitle, meta, blocks);
        return json({ updated: { id: encodeId(rel), title: newTitle } });
      }
    );

    // ── notion-move-pages ───────────────────────────────────────────────────
    server.tool(
      "notion-move-pages",
      "Move one or more pages/databases to a new parent folder (omit new_parent_id for workspace root).",
      { ids: z.array(z.string()).min(1), new_parent_id: z.string().optional() },
      async ({ ids, new_parent_id }) => {
        requireUser();
        const gate = await gateFor();
        if (new_parent_id && !gate.canReadId(new_parent_id)) {
          return err(`Parent not accessible: ${new_parent_id}`);
        }
        const parentRel = new_parent_id ? relOf(new_parent_id) : "";
        const moved: { from: string; to: string }[] = [];
        for (const id of ids) {
          if (!gate.canReadId(id)) return err(`Entity not accessible: ${id}`);
          try {
            const to = moveNode(relOf(id), parentRel);
            moved.push({ from: id, to: encodeId(to) });
          } catch (e) {
            return err(`Move failed for ${id}: ${(e as Error).message}`);
          }
        }
        return json({ moved });
      }
    );

    // ── notion-duplicate-page (async in the official API; sync here) ─────────
    server.tool(
      "notion-duplicate-page",
      "Duplicate a page or database within the workspace. Returns the new entity id and an async task record.",
      { id: z.string() },
      async ({ id }) => {
        requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(id)) return err(`Entity not found: ${id}`);
        try {
          const to = duplicateNode(relOf(id));
          const newId = encodeId(to);
          const task = completedTask(`Duplicated ${id}`, newId);
          return json({ duplicated: { id: newId }, task });
        } catch (e) {
          return err(String((e as Error).message));
        }
      }
    );

    // ── notion-create-database ──────────────────────────────────────────────
    server.tool(
      "notion-create-database",
      "Create a new database with an initial schema. The first column is the title. Column types: text, number, select, multi_select, status, date, checkbox, person, url.",
      {
        title: z.string(),
        parent_id: z.string().optional(),
        properties: z
          .array(z.object({ name: z.string(), type: z.string().optional(), options: z.array(z.string()).optional() }))
          .min(1),
      },
      async ({ title, parent_id, properties }) => {
        requireUser();
        if (parent_id) {
          const gate = await gateFor();
          if (!gate.canReadId(parent_id)) return err(`Parent not accessible: ${parent_id}`);
        }
        try {
          const rel = await createDatabase(parentRelOf(parent_id), title, properties);
          return json({ created: { id: encodeId(rel), title } });
        } catch (e) {
          return err(String((e as Error).message));
        }
      }
    );

    // ── notion-update-data-source ────────────────────────────────────────────
    server.tool(
      "notion-update-data-source",
      "Update a database's schema/description: set description, add columns, rename columns, or remove columns.",
      {
        database_id: z.string(),
        description: z.string().optional(),
        add_columns: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
        rename_columns: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
        remove_columns: z.array(z.string()).optional(),
      },
      async ({ database_id, description, add_columns, rename_columns, remove_columns }) => {
        requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(database_id)) return err(`Database not found: ${database_id}`);
        const rel = relOf(database_id);
        const node = readNode(rel);
        if (!node || node.kind !== "database") return err("Target is not a database.");
        const changed: string[] = [];
        if (typeof description === "string") {
          const meta = await readDbMeta(rel);
          meta.description = description;
          await writeDbMeta(rel, meta);
          changed.push("description");
        }
        for (const c of add_columns ?? []) {
          const r = await writeDbAddColumn(rel, c.name, c.type);
          changed.push(`+${r.name}`);
        }
        for (const r of rename_columns ?? []) {
          const pid = resolveProp(node.properties, r.from);
          if (!pid) return err(`Column not found: ${r.from}`);
          await writeDbRenameColumn(rel, pid, r.to);
          changed.push(`${r.from}→${r.to}`);
        }
        for (const name of remove_columns ?? []) {
          const pid = resolveProp(node.properties, name);
          if (!pid) return err(`Column not found: ${name}`);
          await writeDbDeleteColumn(rel, pid);
          changed.push(`-${name}`);
        }
        return json({ updated: { id: database_id }, changed });
      }
    );

    // ── notion-create-view ───────────────────────────────────────────────────
    server.tool(
      "notion-create-view",
      "Create a view on a database (table, board, list, calendar, timeline, gallery). Optional filters and sorts (property may be a name or column id).",
      {
        database_id: z.string(),
        type: z.enum(["table", "board", "list", "calendar", "timeline", "gallery"]),
        name: z.string().optional(),
        filters: z.array(z.object({ property: z.string(), op: z.string(), value: z.any().optional() })).optional(),
        sorts: z.array(z.object({ property: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional(),
      },
      async ({ database_id, type, name, filters, sorts }) => {
        requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(database_id)) return err(`Database not found: ${database_id}`);
        const rel = relOf(database_id);
        const node = readNode(rel);
        if (!node || node.kind !== "database") return err("Target is not a database.");
        const config = buildViewConfig(node.properties, filters, sorts);
        const view = await okfAddView(rel, { name, type, config });
        return json({ created_view: view });
      }
    );

    // ── notion-update-view ────────────────────────────────────────────────────
    server.tool(
      "notion-update-view",
      "Update a view's name, filters, or sorts.",
      {
        database_id: z.string(),
        view_id: z.string(),
        name: z.string().optional(),
        filters: z.array(z.object({ property: z.string(), op: z.string(), value: z.any().optional() })).optional(),
        sorts: z.array(z.object({ property: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional(),
      },
      async ({ database_id, view_id, name, filters, sorts }) => {
        requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(database_id)) return err(`Database not found: ${database_id}`);
        const rel = relOf(database_id);
        const node = readNode(rel);
        if (!node || node.kind !== "database") return err("Target is not a database.");
        const patch: { name?: string; config?: ViewConfig } = {};
        if (name) patch.name = name;
        if (filters || sorts) patch.config = buildViewConfig(node.properties, filters, sorts);
        const view = await okfPatchView(rel, view_id, patch);
        if (!view) return err(`View not found: ${view_id}`);
        return json({ updated_view: view });
      }
    );

    // ── notion-query-data-sources ─────────────────────────────────────────────
    server.tool(
      "notion-query-data-sources",
      "Query a database's rows and return a Markdown table. Provide either `sql` " +
        "(SELECT * | cols FROM db [WHERE ...] [ORDER BY ...] [LIMIT n]) or structured `filters`+`sorts`.",
      {
        database_id: z.string(),
        sql: z.string().optional().describe("SQL SELECT against this data source (column names or colN ids)"),
        filters: z.array(z.object({ property: z.string(), op: z.string(), value: z.any().optional() })).optional(),
        sorts: z.array(z.object({ property: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional(),
        conjunction: z.enum(["and", "or"]).optional(),
        page_size: z.number().int().min(1).max(200).optional(),
      },
      async ({ database_id, sql, filters, sorts, conjunction, page_size }) => {
        const gate = await gateFor();
        if (!gate.canReadId(database_id)) return err(`Database not found: ${database_id}`);
        const rel = relOf(database_id);
        const snap = await okfDatabaseSnapshot(database_id, rel);
        if (!snap) return err("Target is not a database.");
        let cols: Snapshot["properties"] | undefined;
        let f = filters ?? [];
        let s = sorts ?? [];
        let conj = conjunction ?? "and";
        let cap = page_size ?? 50;
        if (sql) {
          let parsed;
          try {
            parsed = parseSql(sql);
          } catch (e) {
            return err(String((e as Error).message));
          }
          f = parsed.filters;
          s = parsed.sorts;
          conj = parsed.conjunction;
          if (parsed.limit !== null) cap = Math.min(parsed.limit, 200);
          if (parsed.columns !== "*") {
            const picked = parsed.columns
              .map((c) => resolveProp(snap.properties, c))
              .filter((id): id is string => id !== null);
            const unknown = parsed.columns.filter((c) => !resolveProp(snap.properties, c));
            if (unknown.length) return err(`Unknown column(s): ${unknown.join(", ")}`);
            cols = snap.properties.filter((p) => picked.includes(p.id));
          }
        }
        const rows = queryRows(snap, f, s, conj, cap);
        return ok(`${rows.length} row(s) of ${snap.rows.length}\n\n${rowsToMarkdown(snap, rows, cols)}`);
      }
    );

    // ── notion-query-database-view ────────────────────────────────────────────
    server.tool(
      "notion-query-database-view",
      "Run an existing view's filters/sorts against its database and return the rows as a Markdown table.",
      { database_id: z.string(), view_id: z.string(), page_size: z.number().int().min(1).max(200).optional() },
      async ({ database_id, view_id, page_size }) => {
        const gate = await gateFor();
        if (!gate.canReadId(database_id)) return err(`Database not found: ${database_id}`);
        const rel = relOf(database_id);
        const snap = await okfDatabaseSnapshot(database_id, rel);
        if (!snap) return err("Target is not a database.");
        const meta = await readDbMeta(rel);
        const view = meta.views?.find((v) => v.id === view_id);
        if (!view) return err(`View not found: ${view_id}`);
        const cfg = view.config ?? {};
        const filters = (cfg.filters ?? []).map((f: ViewFilter) => ({ property: f.propertyId, op: f.op, value: f.value }));
        const sorts = (cfg.sorts ?? []).map((s: ViewSort) => ({ property: s.propertyId, direction: s.dir }));
        const rows = queryRows(snap, filters, sorts, cfg.filterConjunction ?? "and", page_size ?? 50);
        return ok(`View "${view.name}" — ${rows.length} row(s)\n\n${rowsToMarkdown(snap, rows)}`);
      }
    );

    // ── notion-query-meeting-notes (Notion AI only; no equivalent here) ────────
    server.tool(
      "notion-query-meeting-notes",
      "Query meeting notes. NOT SUPPORTED in this workspace (no Notion AI meeting-notes feature).",
      { query: z.string().optional() },
      async () => err("Meeting notes are a Notion AI feature and are not available in this workspace.")
    );

    // ── notion-create-comment ──────────────────────────────────────────────────
    server.tool(
      "notion-create-comment",
      "Add a comment to a page (page-level) or a specific block, or reply to a thread.",
      {
        page_id: z.string(),
        body: z.string(),
        block_id: z.string().optional(),
        parent_id: z.string().optional().describe("comment id to reply to"),
      },
      async ({ page_id, body, block_id, parent_id }) => {
        const authorId = requireUser();
        const gate = await gateFor();
        if (!gate.canReadId(page_id)) return err(`Page not found: ${page_id}`);
        const [row] = await db
          .insert(comments)
          .values({ pageId: page_id, blockId: block_id ?? null, parentId: parent_id ?? null, authorId, body })
          .returning();
        return json({ comment: { id: row.id, pageId: row.pageId, body: row.body, createdAt: row.createdAt } });
      }
    );

    // ── notion-get-comments ─────────────────────────────────────────────────────
    server.tool(
      "notion-get-comments",
      "List comments/discussions on a page.",
      { page_id: z.string() },
      async ({ page_id }) => {
        const gate = await gateFor();
        if (!gate.canReadId(page_id)) return err(`Page not found: ${page_id}`);
        const rows = await db
          .select({
            id: comments.id,
            body: comments.body,
            blockId: comments.blockId,
            parentId: comments.parentId,
            resolved: comments.resolved,
            createdAt: comments.createdAt,
            author: users.displayName,
          })
          .from(comments)
          .leftJoin(users, eq(comments.authorId, users.id))
          .where(eq(comments.pageId, page_id))
          .orderBy(comments.createdAt);
        return json({ count: rows.length, comments: rows });
      }
    );

    // ── notion-get-teams ─────────────────────────────────────────────────────────
    server.tool(
      "notion-get-teams",
      "List the teamspaces (teams) in the current workspace.",
      {},
      async () => {
        const userId = requireUser();
        const workspaceId = await getDefaultWorkspaceId(userId);
        if (!workspaceId) return json({ teams: [] });
        const rows = await db
          .select({ id: teamspaces.id, name: teamspaces.name, icon: teamspaces.icon })
          .from(teamspaces)
          .where(eq(teamspaces.workspaceId, workspaceId));
        return json({ count: rows.length, teams: rows });
      }
    );

    // ── notion-get-users ───────────────────────────────────────────────────────
    server.tool(
      "notion-get-users",
      "List workspace members (and guests). Pass self=true for just the current user.",
      { self: z.boolean().optional() },
      async ({ self }) => {
        const userId = requireUser();
        if (self) {
          const [u] = await db.select().from(users).where(eq(users.id, userId));
          return json({ user: u ? { id: u.id, name: u.displayName, isAgent: u.isAgent } : null });
        }
        const workspaceId = await getDefaultWorkspaceId(userId);
        if (!workspaceId) return json({ users: [] });
        const rows = await db
          .select({ id: users.id, name: users.displayName, isAgent: users.isAgent, role: workspaceMembers.role })
          .from(workspaceMembers)
          .innerJoin(users, eq(workspaceMembers.userId, users.id))
          .where(eq(workspaceMembers.workspaceId, workspaceId));
        return json({ count: rows.length, users: rows });
      }
    );

    // ── notion-get-async-task ─────────────────────────────────────────────────────
    server.tool(
      "notion-get-async-task",
      "Get the status of an async task started by another tool (e.g. duplicate).",
      { task_id: z.string() },
      async ({ task_id }) => {
        const t = tasks.get(task_id);
        return t ? json(t) : err(`Task not found: ${task_id}`);
      }
    );
  },
  {},
  {
    streamableHttpEndpoint: "/api/mcp",
    disableSse: true,
  }
);

/** Build a ViewConfig from name/id-referenced filters + sorts. */
function buildViewConfig(
  properties: { id: string; name: string }[],
  filters?: { property: string; op: string; value?: unknown }[],
  sorts?: { property: string; direction?: "asc" | "desc" }[]
): ViewConfig {
  const cfg: ViewConfig = {};
  if (filters?.length) {
    cfg.filters = filters
      .map((f) => ({ propertyId: resolveProp(properties, f.property), op: f.op as ViewFilter["op"], value: f.value }))
      .filter((f) => f.propertyId !== null)
      .map((f) => ({ ...f, propertyId: f.propertyId as string }));
  }
  if (sorts?.length) {
    cfg.sorts = sorts
      .map((s) => ({ propertyId: resolveProp(properties, s.property), dir: s.direction ?? "asc" }))
      .filter((s) => s.propertyId !== null)
      .map((s) => ({ ...s, propertyId: s.propertyId as string }));
  }
  return cfg;
}

/** Auth gate — establish identity, then run the MCP handler inside it. */
async function guarded(req: Request): Promise<Response> {
  const id = await resolveIdentity(req);
  if (!id) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized — send Authorization: Bearer <token>" },
        id: null,
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
  return identity.run(id, () => handler(req));
}

export { guarded as GET, guarded as POST, guarded as DELETE };
