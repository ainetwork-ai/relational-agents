#!/usr/bin/env node
/**
 * notion-mcp — MCP server wrapping the notion clone's REST API.
 *
 * Env:
 *   NOTION_BASE_URL      base URL of the running clone (default http://localhost:3000)
 *   NOTION_PRIVATE_KEY   AIN private key → /api/auth/key-login (omit → demo-login)
 *   NOTION_DISPLAY_NAME  display name used with key-login
 *
 * Auth: the clone uses an iron-session cookie ("notion-session"). This server
 * logs in lazily on the first call, keeps the cookie in memory, and re-logs-in
 * once on a 401.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

const BASE_URL = (process.env.NOTION_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MAX_TEXT = 200_000; // cap tool output size

let cookie: string | null = null;

async function login(privateKey?: string, displayName?: string) {
  const key = privateKey ?? process.env.NOTION_PRIVATE_KEY;
  const name = displayName ?? process.env.NOTION_DISPLAY_NAME;
  const res = key
    ? await fetch(`${BASE_URL}/api/auth/key-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privateKey: key, ...(name ? { displayName: name } : {}) }),
      })
    : await fetch(`${BASE_URL}/api/auth/demo-login`, { method: "POST" });

  const setCookies = res.headers.getSetCookie();
  if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

type ApiOpts = {
  query?: Record<string, unknown>;
  body?: unknown;
  form?: FormData;
};

/** Calls the clone API. JSON → parsed object, text → string, binary → saved temp file. */
async function api(method: string, apiPath: string, opts: ApiOpts = {}): Promise<unknown> {
  if (!cookie) await login();

  const url = new URL(`${BASE_URL}/api${apiPath}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const doFetch = () => {
    const headers: Record<string, string> = { cookie: cookie ?? "" };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    return fetch(url, { method, headers, body, redirect: "manual" });
  };

  let res = await doFetch();
  if (res.status === 401) {
    await login();
    res = await doFetch();
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${method} /api${apiPath}: ${text.slice(0, 1000)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (ct.startsWith("text/")) {
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${method} /api${apiPath}: ${text.slice(0, 1000)}`);
    return text;
  }
  // binary (pdf, zip, images…): save to a temp file and return its path
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} /api${apiPath} (${buf.length} bytes)`);
  const ext = ct.includes("pdf") ? "pdf" : ct.includes("zip") ? "zip" : "bin";
  const file = path.join(tmpdir(), `notion-mcp-${randomUUID()}.${ext}`);
  await writeFile(file, buf);
  return { savedTo: file, bytes: buf.length, contentType: ct };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

async function formFromFile(filePath: string, extraFields: Record<string, string> = {}) {
  const buf = await readFile(filePath);
  const name = path.basename(filePath);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: MIME[ext] ?? "application/octet-stream" }), name);
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  return fd;
}

// ---------------------------------------------------------------------------

const server = new McpServer({ name: "notion-clone", version: "0.1.0" });

function toText(data: unknown): string {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}\n… [truncated ${text.length - MAX_TEXT} chars]`
    : text;
}

/** Registers a tool whose handler returns arbitrary data (stringified for MCP). */
function t(name: string, description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<unknown>) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      return { content: [{ type: "text" as const, text: toText(await handler(args)) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
      };
    }
  });
}

const jsonBody = z.record(z.unknown()).optional().describe("JSON body passthrough");

// --- auth --------------------------------------------------------------------
t(
  "login",
  "Log in to the clone. With privateKey → key-login (a per-user identity); without → shared demo user. Called automatically when needed; use this to switch users.",
  { privateKey: z.string().optional(), displayName: z.string().optional() },
  (a) => login(a.privateKey, a.displayName)
);
t("auth_me", "Current logged-in user", {}, () => api("GET", "/auth/me"));
t("auth_logout", "Log out and drop the session cookie", {}, async () => {
  const out = await api("POST", "/auth/logout");
  cookie = null;
  return out;
});

// --- workspace ----------------------------------------------------------------
t("workspace_get", "Get the current workspace", {}, () => api("GET", "/workspace"));
t("workspace_update", "Update workspace settings (PATCH /workspace)", { body: jsonBody }, (a) =>
  api("PATCH", "/workspace", { body: a.body ?? {} })
);
t("workspace_members_list", "List workspace members", {}, () => api("GET", "/workspace/members"));
t("workspace_member_update", "Update a member (PATCH /workspace/members)", { body: jsonBody }, (a) =>
  api("PATCH", "/workspace/members", { body: a.body ?? {} })
);
t("workspace_member_remove", "Remove a member (DELETE /workspace/members)", { body: jsonBody }, (a) =>
  api("DELETE", "/workspace/members", { body: a.body ?? {} })
);
t("workspace_guests_list", "List workspace guests", {}, () => api("GET", "/workspace/guests"));
t("workspace_invite_get", "Get the workspace invite link", {}, () => api("GET", "/workspace/invite"));
t("workspace_invite_create", "Create/rotate the workspace invite link", { body: jsonBody }, (a) =>
  api("POST", "/workspace/invite", { body: a.body ?? {} })
);
t("workspace_export", "Export the workspace (binary → temp file path)", {}, () => api("GET", "/workspace/export"));
t("workspaces_list", "List all workspaces of the current user", {}, () => api("GET", "/workspaces"));
t("workspace_create", "Create a workspace", { body: jsonBody }, (a) => api("POST", "/workspaces", { body: a.body ?? {} }));
t("workspace_switch", "Switch the active workspace", { workspaceId: z.string() }, (a) =>
  api("POST", "/workspaces/switch", { body: { workspaceId: a.workspaceId } })
);
t("teamspaces_list", "List teamspaces", {}, () => api("GET", "/teamspaces"));
t("teamspace_create", "Create a teamspace", { body: jsonBody }, (a) => api("POST", "/teamspaces", { body: a.body ?? {} }));

// --- pages ---------------------------------------------------------------------
t("pages_list", "List pages (Postgres + OKF file-backed merged). archived=true → archived pages", { archived: z.boolean().optional() }, (a) =>
  api("GET", "/pages", { query: a.archived ? { archived: "1" } : {} })
);
t("pages_shared_list", "List pages shared with me", {}, () => api("GET", "/pages/shared"));
t(
  "page_create",
  "Create a page",
  {
    title: z.string().optional(),
    parentPageId: z.string().optional(),
    icon: z.string().optional(),
    teamspaceId: z.string().optional(),
  },
  (a) => api("POST", "/pages", { body: a })
);
t("page_get", "Get page metadata", { pageId: z.string() }, (a) => api("GET", `/pages/${a.pageId}`));
t("page_update", "Update page metadata (title, icon, cover, parent, archive…)", { pageId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/pages/${a.pageId}`, { body: a.body ?? {} })
);
t("page_delete", "Delete/archive a page", { pageId: z.string() }, (a) => api("DELETE", `/pages/${a.pageId}`));
t("page_duplicate", "Duplicate a page", { pageId: z.string() }, (a) => api("POST", `/pages/${a.pageId}/duplicate`));
t("page_blocks_get", "Get a page's content blocks (ordered)", { pageId: z.string() }, (a) =>
  api("GET", `/pages/${a.pageId}/blocks`)
);
t(
  "page_blocks_append",
  'Append blocks (POST). Block shape: { type, content: { text, … }, position? } — e.g. type "paragraph"|"heading1"|"todo"|"image"…',
  { pageId: z.string(), body: jsonBody },
  (a) => api("POST", `/pages/${a.pageId}/blocks`, { body: a.body ?? {} })
);
t(
  "page_blocks_replace",
  "Bulk upsert blocks (PUT { blocks: [{id?, type, content, position}...], deletedIds?: [...] }). NOT a full replace: blocks without id are inserted, existing blocks survive unless listed in deletedIds. To truly replace, pass current block ids in deletedIds.",
  { pageId: z.string(), body: jsonBody },
  (a) => api("PUT", `/pages/${a.pageId}/blocks`, { body: a.body ?? {} })
);
t("page_row_get", "Get the database row backing a page (if the page is a DB row page)", { pageId: z.string() }, (a) =>
  api("GET", `/pages/${a.pageId}/row`)
);
t("page_export", "Export a page (markdown)", { pageId: z.string(), format: z.string().optional() }, (a) =>
  api("GET", `/pages/${a.pageId}/export`, { query: a.format ? { format: a.format } : {} })
);
t("page_export_pdf", "Export a page as PDF (binary → temp file path)", { pageId: z.string() }, (a) =>
  api("GET", `/pages/${a.pageId}/export-pdf`)
);
t("page_history_list", "List page history snapshots", { pageId: z.string() }, (a) => api("GET", `/pages/${a.pageId}/history`));
t("page_history_restore", "Restore a page history snapshot", { pageId: z.string(), snapshotId: z.string() }, (a) =>
  api("POST", `/pages/${a.pageId}/history/${a.snapshotId}`)
);
t("page_members_list", "List page members", { pageId: z.string() }, (a) => api("GET", `/pages/${a.pageId}/members`));
t("page_member_add", "Add a page member (POST /pages/{id}/members)", { pageId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/pages/${a.pageId}/members`, { body: a.body ?? {} })
);
t("page_member_remove", "Remove a page member (DELETE /pages/{id}/members)", { pageId: z.string(), body: jsonBody }, (a) =>
  api("DELETE", `/pages/${a.pageId}/members`, { body: a.body ?? {} })
);
t("page_presence_get", "Who is currently viewing the page", { pageId: z.string() }, (a) =>
  api("GET", `/pages/${a.pageId}/presence`)
);
t("page_presence_ping", "Report presence on a page", { pageId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/pages/${a.pageId}/presence`, { body: a.body ?? {} })
);
t("page_share_get", "Get the page's public-share settings", { pageId: z.string() }, (a) => api("GET", `/pages/${a.pageId}/share`));
t("page_share_create", "Create a public share link for the page", { pageId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/pages/${a.pageId}/share`, { body: a.body ?? {} })
);
t("page_share_update", "Update share settings", { pageId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/pages/${a.pageId}/share`, { body: a.body ?? {} })
);
t("page_share_delete", "Remove the share link", { pageId: z.string() }, (a) => api("DELETE", `/pages/${a.pageId}/share`));

// --- comments ------------------------------------------------------------------
t("page_comments_list", "List comments on a page", { pageId: z.string() }, (a) => api("GET", `/pages/${a.pageId}/comments`));
t("page_comment_add", "Add a comment to a page", { pageId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/pages/${a.pageId}/comments`, { body: a.body ?? {} })
);
t("comment_update", "Edit/resolve a comment", { commentId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/comments/${a.commentId}`, { body: a.body ?? {} })
);
t("comment_delete", "Delete a comment", { commentId: z.string() }, (a) => api("DELETE", `/comments/${a.commentId}`));

// --- databases -------------------------------------------------------------------
t("databases_list", "List databases", {}, () => api("GET", "/databases"));
t("database_create", "Create a database (default 'Tasks' template; add/rename properties afterwards)", { title: z.string().optional() }, (a) =>
  api("POST", "/databases", { body: { title: a.title } })
);
t("database_get", "Get a database snapshot (properties, views, rows)", { databaseId: z.string() }, (a) =>
  api("GET", `/databases/${a.databaseId}`)
);
t("database_update", "Update database metadata", { databaseId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/databases/${a.databaseId}`, { body: a.body ?? {} })
);
t(
  "database_row_add",
  "Append a row. values = { [propertyId]: value } (property ids like col1, col2 from database_get)",
  { databaseId: z.string(), values: z.record(z.unknown()).optional() },
  (a) => api("POST", `/databases/${a.databaseId}/rows`, { body: { values: a.values ?? {} } })
);
t("database_row_update", "Update row cells (PATCH { values })", { databaseId: z.string(), rowId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/databases/${a.databaseId}/rows/${a.rowId}`, { body: a.body ?? {} })
);
t("database_row_delete", "Delete a row", { databaseId: z.string(), rowId: z.string() }, (a) =>
  api("DELETE", `/databases/${a.databaseId}/rows/${a.rowId}`)
);
t(
  "database_property_add",
  "Add a property/column: { name, type, config? } — type: text|number|select|multiselect|date|person|checkbox|url|title…",
  { databaseId: z.string(), name: z.string(), type: z.string(), config: z.record(z.unknown()).optional() },
  (a) => api("POST", `/databases/${a.databaseId}/properties`, { body: { name: a.name, type: a.type, config: a.config } })
);
t("database_property_update", "Rename/retype/reconfigure a property", { databaseId: z.string(), propertyId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/databases/${a.databaseId}/properties/${a.propertyId}`, { body: a.body ?? {} })
);
t("database_property_delete", "Delete a property", { databaseId: z.string(), propertyId: z.string() }, (a) =>
  api("DELETE", `/databases/${a.databaseId}/properties/${a.propertyId}`)
);
t(
  "database_view_add",
  "Add a view: type table|board|list|gallery|calendar (board = kanban)",
  { databaseId: z.string(), type: z.string(), name: z.string().optional(), config: z.record(z.unknown()).optional() },
  (a) => api("POST", `/databases/${a.databaseId}/views`, { body: { type: a.type, name: a.name, config: a.config } })
);
t("database_view_update", "Update a view (name, filters, sorts, groupBy…)", { databaseId: z.string(), viewId: z.string(), body: jsonBody }, (a) =>
  api("PATCH", `/databases/${a.databaseId}/views/${a.viewId}`, { body: a.body ?? {} })
);
t("database_view_delete", "Delete a view", { databaseId: z.string(), viewId: z.string() }, (a) =>
  api("DELETE", `/databases/${a.databaseId}/views/${a.viewId}`)
);
t("database_link", "Link the database into a page (POST /databases/{id}/link)", { databaseId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/databases/${a.databaseId}/link`, { body: a.body ?? {} })
);
t("database_fullpage", "Convert the database to a full page (POST /databases/{id}/fullpage)", { databaseId: z.string(), body: jsonBody }, (a) =>
  api("POST", `/databases/${a.databaseId}/fullpage`, { body: a.body ?? {} })
);

// --- search / files / notifications ----------------------------------------------
t(
  "search",
  "Full-text search. Filters: type page|database, edited today|week|month, creator <userId>",
  {
    q: z.string(),
    type: z.string().optional(),
    edited: z.string().optional(),
    creator: z.string().optional(),
  },
  (a) => api("GET", "/search", { query: a })
);
t(
  "upload_file",
  "Upload a local file → served URL. Images (png/jpeg/gif/webp/svg, ≤10MB) by default; kind='file' allows any type.",
  { path: z.string().describe("local file path"), kind: z.string().optional() },
  async (a) => api("POST", "/upload", { form: await formFromFile(a.path, a.kind ? { kind: a.kind } : {}) })
);
t("import_notion_zip", "Import a Notion export .zip into the OKF content root", { path: z.string() }, async (a) =>
  api("POST", "/import", { form: await formFromFile(a.path) })
);
t("notifications_list", "List notifications", {}, () => api("GET", "/notifications"));
t("notifications_mark_read", "Mark notifications read", { body: jsonBody }, (a) =>
  api("POST", "/notifications/read", { body: a.body ?? {} })
);

// --- invites / share tokens ---------------------------------------------------------
t("invite_info", "Inspect an invite token", { token: z.string() }, (a) => api("GET", `/invite/${a.token}`));
t("invite_accept", "Accept an invite token", { token: z.string() }, (a) => api("POST", `/invite/${a.token}`));
t("share_unlock", "Unlock a password-protected share link", { token: z.string(), body: jsonBody }, (a) =>
  api("POST", `/share/${a.token}/unlock`, { body: a.body ?? {} })
);
t("share_duplicate", "Duplicate a shared page into my workspace", { token: z.string() }, (a) =>
  api("POST", `/share/${a.token}/duplicate`)
);

// --- AI ------------------------------------------------------------------------------
t("ai_write", "AI writing assistant (POST /ai/write)", { body: jsonBody }, (a) => api("POST", "/ai/write", { body: a.body ?? {} }));
t("ai_qa", "AI Q&A over the workspace (POST /ai/qa)", { body: jsonBody }, (a) => api("POST", "/ai/qa", { body: a.body ?? {} }));
t("ai_autofill", "AI database autofill (POST /ai/autofill)", { body: jsonBody }, (a) =>
  api("POST", "/ai/autofill", { body: a.body ?? {} })
);

// --- OKF (file-backed content root) ---------------------------------------------------
t("okf_tree", "OKF folder/file tree (folder=hierarchy, .md=page, .csv=database)", {}, () => api("GET", "/okf/tree"));
t("okf_pages", "List OKF pages", {}, () => api("GET", "/okf/pages"));
t("okf_node", "Read an OKF node (query passthrough, e.g. { path })", { query: z.record(z.string()).optional() }, (a) =>
  api("GET", "/okf/node", { query: a.query ?? {} })
);
t("okf_page_write", "Write an OKF page (PUT /okf/page)", { body: jsonBody }, (a) => api("PUT", "/okf/page", { body: a.body ?? {} }));
t("okf_db_create", "Create an OKF database (POST /okf/db)", { body: jsonBody }, (a) => api("POST", "/okf/db", { body: a.body ?? {} }));
t("okf_db_update", "Update an OKF database (PATCH /okf/db)", { body: jsonBody }, (a) => api("PATCH", "/okf/db", { body: a.body ?? {} }));
t("okf_asset", "Fetch an OKF asset (binary → temp file path)", { query: z.record(z.string()).optional() }, (a) =>
  api("GET", "/okf/asset", { query: a.query ?? {} })
);

// --- chat (relationship-agent data layer) -------------------------------------------
// 에이전트(NOTION_PRIVATE_KEY로 로그인, 방 멤버)가 대화를 듣고 말하는 통로.
// 다른 플랫폼 에이전트(카카오톡 봇 등)도 이 툴로 노션을 공유 메모리로 쓴다.
t("chat_rooms_list", "List my chat rooms (DM + agent rooms)", {}, () => api("GET", "/dm/rooms"));
t(
  "chat_messages_list",
  "List a room's messages in order. sinceMessageId를 주면 그 메시지 이후만 반환 (폴링 회수용, 멱등 처리는 호출자 책임).",
  { roomId: z.string(), sinceMessageId: z.string().optional() },
  async (a) => {
    const data = (await api("GET", `/dm/rooms/${a.roomId}/messages`)) as {
      messages?: { id: string }[];
    };
    if (!a.sinceMessageId || !Array.isArray(data?.messages)) return data;
    const idx = data.messages.findIndex((m) => m.id === a.sinceMessageId);
    return { messages: idx >= 0 ? data.messages.slice(idx + 1) : data.messages };
  }
);
t(
  "chat_message_send",
  "Send a message to a room as the logged-in identity (agent가 방에 발언할 때 사용)",
  { roomId: z.string(), text: z.string() },
  (a) => api("POST", `/dm/rooms/${a.roomId}/messages`, { body: { text: a.text } })
);
t(
  "agent_config_get",
  "Get an agent's config + room docs pointer (에이전트 설정·관계 문서 위치)",
  { roomId: z.string() },
  (a) => api("GET", `/dm/rooms/${a.roomId}/agent`)
);

// --- escape hatch -----------------------------------------------------------------------
t(
  "api_request",
  "Raw escape hatch: call any /api/* endpoint of the clone directly. path is relative to /api (e.g. '/pages/abc/blocks').",
  {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string(),
    query: z.record(z.string()).optional(),
    body: z.record(z.unknown()).optional(),
  },
  (a) => api(a.method, a.path.startsWith("/") ? a.path : `/${a.path}`, { query: a.query, body: a.body })
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`notion-mcp ready — wrapping ${BASE_URL} (login: ${process.env.NOTION_PRIVATE_KEY ? "key" : "demo"})`);
