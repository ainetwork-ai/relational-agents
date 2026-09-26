import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { and, eq, sql } from "drizzle-orm";
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
import { parseMarkdown, blocksToMarkdown, type Frontmatter } from "@/lib/memory-parse";
import { okfGateFor, type OkfGate } from "@/lib/okf-acl";
import { getSession } from "@/lib/auth/session";
import { runAs, runAsOrService } from "@/lib/aindrive-account";
import { userLink } from "@/lib/aindrive-user";
import {
  aindriveConfigured,
  deletePath,
  drivePath,
  parseLink,
  listFiles,
  listTree,
  readFile,
  writeFile,
  type AindriveLink,
} from "@/lib/aindrive";
import { getDefaultWorkspaceId } from "@/lib/workspace";
import { canSeeGift, findGift, giftValid, type GiftContent } from "@/lib/gift";
import { blocks as blockRows, pages as pageRows } from "@/lib/db/schema";
import { announceGift } from "@/lib/gift-announce";
import { A2UI_META_KEY, A2UI_MIME, actionToGift, parseA2uiAction } from "@/lib/x402/a2ui";
import { payGift } from "@/lib/x402/pay";
import { giftSurfaceFor, giftSurfaceInput } from "@/lib/x402/surface";
import { getT } from "@/i18n/server";
import { publicOrigin } from "@/lib/app-origin";
import { answerViewers } from "@/lib/agent/shared-drives";
import {
  fetchPromptContent,
  PromptNotFound,
  renderPrompt,
  resolveTarget,
  workspacesOf,
  type PromptContent,
} from "@/lib/prompt-export";
import { db } from "@/lib/db";
import {
  agentAccessTokens,
  chatRoomBots,
  chatRoomMembers,
  chatRooms,
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
 * Endpoint: /api/mcp (GET = server→client stream, POST = messages, DELETE = end session)
 *
 * GOAL: functional parity with the official hosted MCP server
 * (mcp..com), adapted to this app's canonical OKF file store (folder=DB).
 * Tool names follow `-*` convention and content flows as
 * Markdown, matching the official server's agent-first design.
 *
 * Auth (required): OKF files hold participant-only content, so this surface
 * passes the okf_acl gate too. Three identities: (1) Bearer <agent token> =
 * that agent, (2) Bearer <MCP_SERVICE_TOKEN> = service (public read-only),
 * (3) session cookie = that user.
 */

// ── request-scoped identity (handler is built once → AsyncLocalStorage) ──────
type Identity = {
  userId: string;
  label: "agent" | "service" | "session";
  /** an agent token's holder: the room member it was minted for (see agentReaders) */
  ownerId?: string;
};
const identity = new AsyncLocalStorage<Identity>();
const who = (): Identity => identity.getStore() ?? { userId: "", label: "service" };
const currentUserId = () => who().userId;
const gateFor = (): Promise<OkfGate> => okfGateFor(currentUserId());

/** Mutations and identity-bound reads need a real person/agent, not the public
 * service token. Throw → surfaced as an MCP tool error. */
function requireUser(): string {
  const id = currentUserId();
  if (!id) throw new Error("This action requires a user or agent identity (not the public service token).");
  return id;
}

async function resolveIdentity(req: Request): Promise<Identity | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const [row] = await db.select().from(agentAccessTokens).where(eq(agentAccessTokens.token, bearer));
    if (row) return { userId: row.agentUserId, label: "agent", ownerId: row.userId };
    const service = process.env.MCP_SERVICE_TOKEN;
    if (service && bearer === service) return { userId: "", label: "service" };
    return null; // unknown token → reject (never silently fall back to session)
  }
  const session = await getSession().catch(() => null);
  if (session?.userId) return { userId: session.userId, label: "session" };
  return null;
}

/**
 * Who a relationship-agent token reads for in page-to-prompt: the room the agent belongs
 * to — everyone in it (answerViewers, the same readers the agent answers that room for)
 * and that room's workspace alone (the caller confines ids, titles and everything the
 * prompt reaches to it) — and only while the token's holder is still a member of an open
 * room. Not the holder's own access: the token is for importing the room's agent into an
 * external platform, and its output leaves ainmem. (In a room of one person — their
 * assistant — "everyone in it" is that person, still in that workspace only.) Null when
 * that does not hold (no single such room, no workspace, the holder left, the room was
 * dissolved).
 */
async function agentReaders(agentUserId: string, holderId: string): Promise<{ viewerIds: string[]; workspaceIds: string[] } | null> {
  if (!agentUserId || !holderId) return null;
  const bots = await db.select({ roomId: chatRoomBots.roomId }).from(chatRoomBots).where(eq(chatRoomBots.agentUserId, agentUserId));
  const rooms: { id: string; workspaceId: string }[] = [];
  for (const b of bots) {
    const [room] = await db
      .select({ id: chatRooms.id, workspaceId: chatRooms.workspaceId, dissolvedAt: chatRooms.dissolvedAt })
      .from(chatRooms)
      .where(eq(chatRooms.id, b.roomId));
    if (!room?.workspaceId || room.dissolvedAt) continue;
    const [inRoom] = await db
      .select({ u: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.roomId, room.id), eq(chatRoomMembers.userId, holderId)));
    if (inRoom) rooms.push({ id: room.id, workspaceId: room.workspaceId });
  }
  if (rooms.length !== 1) return null;
  return { viewerIds: await answerViewers(rooms[0].id, holderId, null), workspaceIds: [rooms[0].workspaceId] };
}

/** The aindrive folder this caller may use, and the account its calls run as.
 * An agent gets only its own link (`agentConfig.aindrive`), run as whoever
 * linked it; a signed-in person gets the folder they linked from Home, run as
 * their own aindrive account; the public service token gets none. */
async function linkForCaller(): Promise<{ link: AindriveLink; as: <T>(fn: () => Promise<T>) => Promise<T> }> {
  const userId = requireUser();
  if (!aindriveConfigured()) throw new Error("aindrive is not configured on this server.");
  if (who().label === "agent") {
    const [row] = await db.select({ agentConfig: users.agentConfig }).from(users).where(eq(users.id, userId));
    const raw = row?.agentConfig?.aindrive as { linkedBy?: unknown } | undefined;
    const own = parseLink(raw);
    if (!own) throw new Error("This agent has no aindrive folder linked (agent settings → aindrive folder).");
    const by = typeof raw?.linkedBy === "string" ? raw.linkedBy : null;
    return { link: own, as: (fn) => runAsOrService(by, fn) };
  }
  const link = await userLink(userId);
  if (!link) throw new Error("No aindrive folder is linked (Home → aindrive).");
  return { link, as: (fn) => runAs(userId, fn) };
}

// ── helpers ──────────────────────────────────────────────────────────────
const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));

/** OKF id → rel path, validated. Throws for non-OKF ids. */
function relOf(id: string): string {
  if (!isOkfId(id)) throw new Error(`Not a valid entity id: ${id}`);
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

/** Render a database snapshot's rows as a Markdown table. */
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
 * SELECT * | col[, col] ... [WHERE cond [AND|OR cond]...] [ORDER BY col [ASC|DESC]...] [LIMIT n]
 * Conditions: col {= | != | <> | > | < | >= | <= | LIKE | NOT LIKE} 'value'|number.
 * Column names are matched by display name or colN id (case-insensitive). */
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

/** Render any OKF node as Markdown (the `app-fetch` shape). */
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

// ── async-task registry (parity with get-async-task) ─────────────────
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

 // ── -search ─────────────────────────────────────────────────────
    server.tool(
      "memory-search",
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

 // ── app-fetch ───────────────────────────────────────────────────────
    server.tool(
      "app-fetch",
      "Retrieve an entity (page, database, or row) by id as Markdown. Pass id='self' for the current identity + workspace.",
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

    // ── page-to-prompt (notion2prompt) ────────────────────────────────────
    server.tool(
      "page-to-prompt",
      "Turn a page, database or block into an AI-ready prompt (notion2prompt): its blocks, child pages down to `depth`, child databases as tables, properties and metadata, in the claude-xml, default or markdown template. `page` is an id (Postgres uuid or OKF id), a /p/<id> link or a title. A signed-in person reads with their own access; a room agent's token reads for its room: only what everyone in that room may see, and only in that room's workspace — an id or link from another workspace is not found (OKF docs, which belong to no workspace, still need everyone in the room to be allowed to read them). What the readers cannot all see is left out. format='json' adds the files, counts and what was left out; stage='fetch' returns the content tree, and passing that back as `content` renders it again without reading anything.",
      {
        page: z.string().optional().describe("page / database / block id, a /p/<id> link, or a title"),
        content: z.record(z.string(), z.unknown()).optional().describe("a stage='fetch' result to render again"),
        template: z.enum(["claude-xml", "default", "markdown"]).optional(),
        depth: z.number().int().min(0).max(50).optional().describe("levels of child pages below the root (default 5)"),
        limit: z.number().int().min(1).max(100000).optional().describe("cap on root + blocks + rows + child pages (default 1000)"),
        child_pages: z.boolean().optional().describe("follow child pages (default true)"),
        separate_child_pages: z.boolean().optional().describe("one file per page (default true) or merged inline"),
        always_fetch_databases: z.boolean().optional().describe("resolve child databases beyond depth"),
        include_properties: z.union([z.boolean(), z.literal("auto")]).optional().describe("page Properties section (default: auto; false with layout notion2prompt, as upstream)"),
        instruction: z.string().optional().describe("text for <instructions>"),
        layout: z.enum(["ainmem", "notion2prompt"]).optional().describe("file paths/tree: ainmem breadcrumbs, or notion2prompt's own"),
        format: z.enum(["text", "json"]).optional(),
        stage: z.enum(["fetch", "render"]).optional(),
      },
      async (a) => {
        const me = who();
        if (me.label === "service") return err("page-to-prompt needs a signed-in person or a room agent's token.");
        const render = {
          ...(a.template ? { template: a.template } : {}),
          ...(a.separate_child_pages !== undefined ? { separateChildPages: a.separate_child_pages } : {}),
          ...(a.include_properties !== undefined ? { includeProperties: a.include_properties } : {}),
          ...(a.instruction !== undefined ? { instruction: a.instruction } : {}),
          ...(a.layout ? { layout: a.layout } : {}),
        };
        const show = (content: PromptContent) => {
          const out = renderPrompt(content, render);
          return a.format === "json"
            ? json({ prompt: out.prompt, files: out.files, sourceTree: out.sourceTree, chars: out.chars, estimatedTokens: out.estimatedTokens, stats: content.stats, skipped: content.skipped })
            : ok(out.prompt);
        };
        if (a.content) {
          const c = a.content as unknown as PromptContent;
          if (c.version !== 1 || !c.root || !c.pages || !c.databases || !c.tree || !c.location) return err("`content` is not a page-to-prompt fetch result.");
          return show(c);
        }
        if (!a.page) return err("Give `page` (an id, a link or a title) or `content`.");
        let scope: { viewerIds: string[]; workspaceIds: string[]; onlyWorkspaces?: string[] } | null;
        if (me.label === "agent") {
          const room = await agentReaders(me.userId, me.ownerId ?? "");
          if (!room) return err("This agent token reads only for its room, and it has no open room with you in it.");
          // the room's workspace alone — an id or a link elsewhere is not found, and nothing
          // the prompt reaches from there (a sub-page, a mention) is read outside it either
          scope = { ...room, onlyWorkspaces: room.workspaceIds };
        } else {
          const viewer = requireUser();
          scope = { viewerIds: [viewer], workspaceIds: await workspacesOf(viewer) };
        }
        const readers = { ...scope, baseUrl: publicOrigin() };
        const r = await resolveTarget(a.page, readers);
        if ("ambiguous" in r) return err(`Several match — use one of these ids: ${r.ambiguous.map((c) => `${c.id} (${c.title})`).join(", ")}`);
        if ("none" in r) return err(`Entity not found: ${a.page}`);
        try {
          const content = await fetchPromptContent(r.found, { depth: a.depth, limit: a.limit, childPages: a.child_pages, alwaysFetchDatabases: a.always_fetch_databases }, readers);
          return a.stage === "fetch" ? json(content) : show(content);
        } catch (e) {
          if (e instanceof PromptNotFound) return err(`Entity not found: ${a.page}`);
          return err(String((e as Error).message));
        }
      }
    );

 // ── -create-pages ─────────────────────────────────────────────────
    server.tool(
      "memory-create-pages",
      "Create one or more pages. Each page has a title, optional parent id, optional Markdown content, and optional icon (emoji).",
      {
        pages: z
          .array(
            z.object({
              title: z.string(),
              parent_id: z.string().optional().describe("parent page/folder id; omit for workspace root"),
              content: z.string().optional().describe("Markdown body"),
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

 // ── update-page ──────────────────────────────────────────────────
    server.tool(
      "update-page",
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

 // ── -move-pages ───────────────────────────────────────────────────
    server.tool(
      "memory-move-pages",
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

 // ── -duplicate-page (async in the official API; sync here) ─────────
    server.tool(
      "memory-duplicate-page",
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

 // ── -create-database ──────────────────────────────────────────────
    server.tool(
      "memory-create-database",
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

 // ── update-data-source ────────────────────────────────────────────
    server.tool(
      "update-data-source",
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

 // ── -create-view ───────────────────────────────────────────────────
    server.tool(
      "memory-create-view",
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

 // ── update-view ────────────────────────────────────────────────────
    server.tool(
      "update-view",
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

 // ── -query-data-sources ─────────────────────────────────────────────
    server.tool(
      "memory-query-data-sources",
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

 // ── -query-database-view ────────────────────────────────────────────
    server.tool(
      "memory-query-database-view",
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

 // ── -query-meeting-notes ────────
    server.tool(
      "memory-query-meeting-notes",
      "Query meeting notes. NOT SUPPORTED in this workspace (no the workspace AI meeting-notes feature).",
      { query: z.string().optional() },
      async () => err("Meeting notes are a the workspace AI feature and are not available in this workspace.")
    );

 // ── -create-comment ──────────────────────────────────────────────────
    server.tool(
      "memory-create-comment",
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

 // ── -get-comments ─────────────────────────────────────────────────────
    server.tool(
      "memory-get-comments",
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

 // ── -get-teams ─────────────────────────────────────────────────────────
    server.tool(
      "memory-get-teams",
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

 // ── -get-users ───────────────────────────────────────────────────────
    server.tool(
      "memory-get-users",
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

 // ── get-async-task ─────────────────────────────────────────────────────
    server.tool(
      "get-async-task",
      "Get the status of an async task started by another tool (e.g. duplicate).",
      { task_id: z.string() },
      async ({ task_id }) => {
        const t = tasks.get(task_id);
        return t ? json(t) : err(`Task not found: ${task_id}`);
      }
    );

 // ── aindrive (linked drive files, via aindrive's own MCP) ─────────────
    server.tool(
      "aindrive-list",
      "List files in the linked aindrive folder. `path` is relative to the linked folder ('' = its root); `recursive` returns every file path under it.",
      {
        path: z.string().optional().describe("folder relative to the linked root (default '')"),
        recursive: z.boolean().optional(),
      },
      async ({ path, recursive }) => {
        try {
          const { link, as } = await linkForCaller();
          if (recursive)
            return json({ drive: link, files: await as(() => listTree({ ...link, root: drivePath(link, path ?? "") })) });
          return json({ drive: link, entries: await as(() => listFiles(link, path ?? "")) });
        } catch (e) {
          return err((e as Error).message);
        }
      }
    );

    server.tool(
      "aindrive-read",
      "Read a UTF-8 text file from the linked aindrive folder (path relative to the linked root).",
      { path: z.string().describe("file path relative to the linked root") },
      async ({ path }) => {
        try {
          const { link, as } = await linkForCaller();
          return ok(await as(() => readFile(link, path)));
        } catch (e) {
          return err((e as Error).message);
        }
      }
    );

    server.tool(
      "aindrive-delete",
      "Delete a file, or a folder with everything in it, from the linked aindrive folder (path relative to the linked root; the linked folder itself cannot be deleted).",
      { path: z.string().describe("file or folder path relative to the linked root") },
      async ({ path }) => {
        try {
          const { link, as } = await linkForCaller();
          await as(() => deletePath(link, path));
          return json({ ok: true, driveId: link.driveId, path: drivePath(link, path) });
        } catch (e) {
          return err((e as Error).message);
        }
      }
    );

    server.tool(
      "aindrive-write",
      "Create or overwrite a UTF-8 text file in the linked aindrive folder (path relative to the linked root). Intermediate folders are created.",
      {
        path: z.string().describe("file path relative to the linked root"),
        content: z.string(),
      },
      async ({ path, content }) => {
        try {
          const { link, as } = await linkForCaller();
          await as(() => writeFile(link, path, content));
          return json({ ok: true, driveId: link.driveId, path: drivePath(link, path), bytes: Buffer.byteLength(content) });
        } catch (e) {
          return err((e as Error).message);
        }
      }
    );

    // ── gifts behind x402 (lib/x402) ─────────────────────────────────────
    // Each result carries the gift's A2UI surface in _meta (UI-only) and as an
    // application/a2ui+json resource, the way aindrive's tools do, so one
    // renderer (aindrive's MCP Apps view, CopilotKit) draws both. A click on
    // the surface comes back as a2ui_action — the same tool aindrive offers.
    const withSurface = (text: string, structured: Record<string, unknown>, surface: unknown, surfaceId: string) => ({
      content: [
        { type: "text" as const, text },
        { type: "resource" as const, resource: { uri: `a2ui://ainmem/${surfaceId}`, mimeType: A2UI_MIME, text: JSON.stringify(surface) } },
      ],
      structuredContent: structured,
      _meta: { [A2UI_META_KEY]: surface },
    });
    server.tool(
      "list_gifts",
      "Gifts behind x402 in the caller's workspace — files their makers keep unshared, opened by paying pocket money to them. Each carries its A2UI surface.",
      {},
      async () => {
        const me = currentUserId();
        if (!me) return err("sign in first");
        const rows = await db
          .select({ content: blockRows.content, pageId: blockRows.pageId, workspaceId: pageRows.workspaceId })
          .from(blockRows)
          .innerJoin(pageRows, eq(pageRows.id, blockRows.pageId))
          .where(sql`${blockRows.content}->'gift' is not null`);
        const gifts: { gift: GiftContent; pageId: string }[] = [];
        for (const r of rows) {
          const g = (r.content as { gift?: unknown }).gift;
          if (giftValid(g) && (await canSeeGift(me, r.workspaceId))) gifts.push({ gift: g, pageId: r.pageId });
        }
        const out = [];
        for (const g of gifts) out.push({ ...(await giftSurfaceInput(g.gift, me)), pageId: g.pageId });
        return json({ gifts: out });
      }
    );
    server.tool(
      "gift_surface",
      "One gift as an A2UI v0.9 surface (locked: preview + pay button; open: the video + receipt), as the caller sees it.",
      { gift_id: z.string() },
      async ({ gift_id }) => {
        const me = currentUserId();
        if (!me) return err("sign in first");
        const surface = await giftSurfaceFor(gift_id, me, await getT());
        if (!surface) return err("gift not found");
        return withSurface(`gift ${gift_id}`, { gift_id }, surface, `ainmem-gift-${gift_id}`);
      }
    );
    server.tool(
      "pay_gift",
      "Pay for a gift over x402 as the caller (402 → sign with their wallet → settle → unlock) and return the opened surface.",
      { gift_id: z.string() },
      async ({ gift_id }) => payAsCaller(gift_id)
    );
    server.tool(
      "a2ui_action",
      "Handle an A2UI user action from an ainmem surface (a button click in the rendered UI). Pass the renderer's action object; returns the next surface.",
      { action: z.object({}).passthrough() },
      async ({ action }) => {
        const a = parseA2uiAction(action);
        const want = a ? actionToGift(a) : { error: "missing action" };
        if ("error" in want) return err(want.error);
        return payAsCaller(want.giftId);
      }
    );
    async function payAsCaller(giftId: string) {
      const me = currentUserId();
      if (!me) return err("sign in first");
      const found = await findGift(giftId);
      if (!found || !(await canSeeGift(me, found.workspaceId))) return err("gift not found");
      const surfaceId = `ainmem-gift-${giftId}`;
      if (found.gift.spec.recipientUserId === me) {
        const s = await giftSurfaceFor(giftId, me, await getT(), "You can watch your own video without pocket money");
        return withSurface("your own gift — no payment needed", { gift_id: giftId, unlocked: true }, s, surfaceId);
      }
      const r = await payGift(me, giftId);
      if (r.ok && !r.already) await announceGift(found.workspaceId, me, r.spec, r.receipt).catch(() => {});
      const s = await giftSurfaceFor(giftId, me, await getT(), r.ok ? undefined : r.error);
      return r.ok
        ? withSurface(`paid over x402 (${r.settlement ?? "settled"}) · receipt ${r.receipt}`, { gift_id: giftId, unlocked: true, receipt: r.receipt, settlement: r.settlement ?? null }, s, surfaceId)
        : { ...withSurface(`not paid: ${r.error}`, { gift_id: giftId, unlocked: false, error: r.error }, s, surfaceId), isError: true };
    }
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
