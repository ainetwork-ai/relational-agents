import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * aindrive, reached the way any MCP client reaches it: its Streamable HTTP
 * endpoint (`<server>/mcp`, the same tool surface as `aindrive mcp`), with the
 * drive owner's session JWT as a Bearer token. The files never pass through
 * this app's disk — every read and write is an RPC to the aindrive CLI running
 * on the machine that holds the folder.
 *
 * A "link" is one drive plus an optional folder inside it. Everything here is
 * confined to that folder: a path is taken relative to the link's root and a
 * path that climbs out of it is refused before any request is made. aindrive
 * itself still gates every call by the token's role on that path.
 *
 * env:
 *   AINDRIVE_SERVER    e.g. https://aindrive.ainetwork.ai (no /mcp)
 *   AINDRIVE_TOKEN     aindrive session JWT (`aindrive login` → credentials.json)
 *   AINDRIVE_DRIVE_ID  the linked drive, when a caller does not name one
 *   AINDRIVE_ROOT      folder inside that drive the link is confined to ('' = whole drive)
 *   AINDRIVE_ALLOWED_DRIVES  comma-separated drive ids agents may also be linked to;
 *                      "*" = every drive the token's account has (the whole
 *                      logged-in aindrive account is offered)
 *   AINDRIVE_PUBLIC_URL  aindrive's web origin as users reach it (default AINDRIVE_SERVER)
 *
 * The token is one owner's, shared by the whole deployment, so which drives it
 * can reach is not the question — which of them this deployment offers is. A
 * per-agent link must fall inside the default link or name an allowed drive;
 * otherwise any room member could point their agent at every drive the owner has.
 */

export interface AindriveLink {
  driveId: string;
  /** folder inside the drive; '' = the whole drive */
  root: string;
}

export interface AindriveEntry {
  name: string;
  isDir: boolean;
  size?: number;
}

export class AindriveError extends Error {}

/** The aindrive server this deployment talks to (AINDRIVE_SERVER), or null. */
export function aindriveServer(): string | null {
  return process.env.AINDRIVE_SERVER?.trim().replace(/\/+$/, "") || null;
}

// Whose aindrive account a call runs as. Set by runAsAindriveUser (a person's
// own connected account — lib/aindrive-account); absent, calls fall back to the
// deployment's AINDRIVE_TOKEN, when one is set.
const identity = new AsyncLocalStorage<{ token: string }>();

/** Runs `fn` with every aindrive call made as the account behind `token`. */
export function runAsAindriveUser<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return identity.run({ token }, fn);
}

/** True inside runAsAindriveUser: calls reach only that person's own drives. */
export function actingAsUser(): boolean {
  return !!identity.getStore();
}

/** Server + the token this call runs with, or null when there is none. */
function config(): { server: string; token: string } | null {
  const server = aindriveServer();
  const token = identity.getStore()?.token ?? process.env.AINDRIVE_TOKEN?.trim();
  return server && token ? { server, token } : null;
}

/** aindrive is set up here (a server to talk to). Whether a given person can
 *  reach it depends on their connected account — see lib/aindrive-account. */
export function aindriveConfigured(): boolean {
  return aindriveServer() !== null;
}

/** A deployment-wide token is set (legacy / service use: agents, backups of
 *  links made before per-person accounts). */
export function hasServiceToken(): boolean {
  return !!process.env.AINDRIVE_TOKEN?.trim();
}

/** The env-level default link, or null when no drive is linked. */
export function defaultLink(): AindriveLink | null {
  const driveId = process.env.AINDRIVE_DRIVE_ID?.trim();
  if (!driveId) return null;
  return { driveId, root: cleanPath(process.env.AINDRIVE_ROOT ?? "") };
}

/** Whether this deployment lets an agent be linked to `link` (see header). */
export function linkAllowed(link: AindriveLink): boolean {
  // a person's own account already limits them to their own drives
  if (actingAsUser()) return true;
  const allowed = (process.env.AINDRIVE_ALLOWED_DRIVES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes("*") || allowed.includes(link.driveId)) return true;
  const base = defaultLink();
  if (!base || base.driveId !== link.driveId) return false;
  return !base.root || link.root === base.root || link.root.startsWith(`${base.root}/`);
}

/** A stored link's shape, without the deployment allowlist — for links whose
 *  calls run as the person who made them (their own account bounds them). */
export function parseLink(raw: unknown): AindriveLink | null {
  if (!raw || typeof raw !== "object") return null;
  const { driveId, root } = raw as { driveId?: unknown; root?: unknown };
  if (typeof driveId !== "string" || !driveId.trim()) return null;
  return { driveId: driveId.trim(), root: cleanPath(typeof root === "string" ? root : "") };
}

/** Whether the current account (see runAsAindriveUser) has this drive. */
export async function hasDrive(driveId: string): Promise<boolean> {
  return (await listDrives()).some((d) => d.id === driveId);
}

/** An agent's own link (`agentConfig.aindrive`), or null when it has none.
 *  Throws for a malformed path or a drive this deployment does not offer. */
export function linkFromConfig(raw: unknown): AindriveLink | null {
  if (!raw || typeof raw !== "object") return null;
  const { driveId, root } = raw as { driveId?: unknown; root?: unknown };
  if (typeof driveId !== "string" || !driveId.trim()) return null;
  const link = { driveId: driveId.trim(), root: cleanPath(typeof root === "string" ? root : "") };
  if (!linkAllowed(link)) throw new AindriveError(`drive folder not offered here: ${link.driveId}/${link.root}`);
  return link;
}

/** Normalizes a drive path ('a//b/' → 'a/b') and refuses anything that climbs out. */
export function cleanPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) throw new AindriveError(`path may not contain '..': ${p}`);
  return parts.join("/");
}

/** Link-relative path → drive path. */
export function drivePath(link: AindriveLink, rel: string): string {
  const p = cleanPath(rel);
  return link.root ? (p ? `${link.root}/${p}` : link.root) : p;
}

// ── MCP transport ───────────────────────────────────────────────────────────

// aindrive's /mcp is stateless, so one connected client per token serves every
// request until it fails; a failure drops it and the next call reconnects.
const CLIENTS_KEY = Symbol.for("app.aindrive.clients");
function clients(): Map<string, Promise<Client>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<Client>>>;
  return (g[CLIENTS_KEY] ??= new Map());
}

async function connect(cfg: { server: string; token: string }): Promise<Client> {
  const c = new Client({ name: "relational-agents", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${cfg.server}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } },
  });
  await c.connect(transport);
  return c;
}

// Every call waits on an RPC to someone's machine, and an agent's reply waits on
// these calls — a drive that hangs must cost seconds, not the SDK's minute.
const CALL_TIMEOUT_MS = 15_000;

/** Calls one aindrive MCP tool; a tool error becomes an AindriveError. */
async function callTool(name: string, args: Record<string, unknown>, timeout = CALL_TIMEOUT_MS): Promise<unknown> {
  const cfg = config();
  if (!cfg)
    throw new AindriveError(
      aindriveServer()
        ? "aindrive account not connected — connect aindrive first"
        : "aindrive is not configured (AINDRIVE_SERVER)"
    );
  const key = `${cfg.server} ${cfg.token}`;
  let client = clients().get(key);
  if (!client) {
    client = connect(cfg);
    clients().set(key, client);
  }
  let res;
  try {
    res = await (await client).callTool({ name, arguments: args }, undefined, { timeout });
  } catch (e) {
    clients().delete(key);
    throw e instanceof AindriveError ? e : new AindriveError(`aindrive ${name}: ${(e as Error).message}`);
  }
  const text = Array.isArray(res.content)
    ? res.content.map((p) => (p && p.type === "text" ? p.text : "")).join("\n")
    : "";
  if (res.isError) throw new AindriveError(`aindrive ${name}: ${text || "failed"}`);
  return res.structuredContent ?? text;
}

/** The tool names aindrive's MCP offers to the current account — how this app
 *  notices a capability aindrive grew (x402 payment tools, say) without a
 *  deploy. Cached per token for a few minutes; empty when aindrive is not
 *  reachable, so callers treat "absent" as "not yet". */
const TOOLS_TTL_MS = 5 * 60_000;
const toolsCache = new Map<string, { at: number; names: Set<string> }>();
export async function listToolNames(): Promise<Set<string>> {
  const cfg = config();
  if (!cfg) return new Set();
  const key = `${cfg.server} ${cfg.token}`;
  const hit = toolsCache.get(key);
  if (hit && Date.now() - hit.at < TOOLS_TTL_MS) return hit.names;
  let client = clients().get(key);
  if (!client) {
    client = connect(cfg);
    clients().set(key, client);
  }
  try {
    const res = await (await client).listTools(undefined, { timeout: CALL_TIMEOUT_MS });
    const names = new Set(res.tools.map((t) => t.name));
    toolsCache.set(key, { at: Date.now(), names });
    return names;
  } catch {
    clients().delete(key);
    return new Set();
  }
}

/** Calls an aindrive MCP tool by name with a raw argument object — for tools
 *  this app knows only by convention (see lib/x402/aindrive). */
export function callAindriveTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<unknown> {
  return callTool(name, args, timeout);
}

// ── operations (paths are link-relative) ────────────────────────────────────

export async function listDrives(): Promise<{ id: string; name: string }[]> {
  const r = (await callTool("list_drives", {})) as { drives?: { id: string; name: string }[] };
  return (r.drives ?? []).map(({ id, name }) => ({ id, name }));
}

export async function listFiles(link: AindriveLink, rel = ""): Promise<AindriveEntry[]> {
  const r = (await callTool("list_files", { drive_id: link.driveId, path: drivePath(link, rel) })) as {
    entries?: AindriveEntry[];
  };
  return r.entries ?? [];
}

export async function readFile(link: AindriveLink, rel: string): Promise<string> {
  const path = drivePath(link, rel);
  if (!path) throw new AindriveError("path required");
  const r = (await callTool("read_file", { drive_id: link.driveId, path, encoding: "utf8" })) as {
    content?: unknown;
  };
  return typeof r.content === "string" ? r.content : "";
}

/** A file's raw bytes (read_file, base64). Refuses files over `maxBytes`
 *  after the read — aindrive has no size-only call through its skills. */
export async function readFileBytes(link: AindriveLink, rel: string, maxBytes = 30 * 1024 * 1024): Promise<Buffer> {
  const path = drivePath(link, rel);
  if (!path) throw new AindriveError("path required");
  const r = (await callTool("read_file", { drive_id: link.driveId, path, encoding: "base64" })) as {
    content?: unknown;
  };
  const b64 = typeof r.content === "string" ? r.content : "";
  if (Math.floor((b64.length * 3) / 4) > maxBytes) throw new AindriveError("aindrive read_file: [too_large] file too large to open here");
  return Buffer.from(b64, "base64");
}

/** The public aindrive web origin, for links people can open themselves. */
export function aindrivePublicBase(): string | null {
  const b = (process.env.AINDRIVE_PUBLIC_URL || process.env.AINDRIVE_SERVER || "").trim().replace(/\/+$/, "");
  return b || null;
}

export async function writeFile(link: AindriveLink, rel: string, content: string): Promise<void> {
  const path = drivePath(link, rel);
  if (!path || path === link.root) throw new AindriveError("a file path inside the linked folder is required");
  await callTool("write_file", { drive_id: link.driveId, path, content, encoding: "utf8" });
}

/** Writes raw bytes (a photo, a recording, a video) — sent base64 over MCP. */
export async function writeFileBytes(link: AindriveLink, rel: string, bytes: Buffer): Promise<void> {
  const path = drivePath(link, rel);
  if (!path || path === link.root) throw new AindriveError("a file path inside the linked folder is required");
  await callTool("write_file", { drive_id: link.driveId, path, content: bytes.toString("base64"), encoding: "base64" }, 120_000);
}

/** Deletes a file, or a folder with everything in it (aindrive's delete_path).
 *  The linked folder itself is never a target — only what is inside it. */
export async function deletePath(link: AindriveLink, rel: string): Promise<void> {
  const path = drivePath(link, rel);
  if (!path || path === link.root) throw new AindriveError("a path inside the linked folder is required");
  await callTool("delete_path", { drive_id: link.driveId, path });
}

/** The drives this deployment offers for linking, with names — the default
 *  drive (at its root folder) and the allowlist, intersected with what the
 *  token can actually reach. */
export async function offeredDrives(): Promise<{ id: string; name: string; root: string; online: boolean }[]> {
  const base = defaultLink();
  const drives = (await listDrives())
    .map((d) => ({ ...d, root: base?.driveId === d.id ? base.root : "" }))
    .filter((d) => linkAllowed({ driveId: d.id, root: d.root }));
  // A drive's files are only reachable while its CLI is connected — say which
  // ones are, so nobody links a folder that cannot be read.
  const online = await Promise.all(drives.map((d) => driveOnline(d.id)));
  // the ones that can be picked first; otherwise the account's own order
  return drives
    .map((d, i) => ({ ...d, online: online[i] }))
    .sort((a, b) => Number(b.online) - Number(a.online));
}

/** Whether a drive's aindrive CLI is connected: a root listing answers, an
 *  offline drive fails at once ("agent offline"). */
export async function driveOnline(driveId: string): Promise<boolean> {
  try {
    await callTool("list_files", { drive_id: driveId, path: "" }, 5_000);
    return true;
  } catch {
    return false;
  }
}

export interface AindriveTreeEntry {
  /** link-relative path */
  path: string;
  isDir: boolean;
  size?: number;
}

/** Every file and folder under the link, depth-first so a folder is followed
 *  by its contents (the order a tree view draws them in). Capped. */
export async function walkTree(link: AindriveLink, limit = 1000, maxDirs = 100): Promise<AindriveTreeEntry[]> {
  const out: AindriveTreeEntry[] = [];
  let dirs = 0;
  async function walk(dir: string) {
    if (out.length >= limit || dirs++ >= maxDirs) return;
    const entries = (await listFiles(link, dir)).sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    for (const e of entries) {
      if (out.length >= limit) return;
      const path = dir ? `${dir}/${e.name}` : e.name;
      out.push({ path, isDir: e.isDir, size: e.isDir ? undefined : e.size });
      if (e.isDir) await walk(path);
    }
  }
  await walk("");
  return out;
}

/** Every file under the link (breadth-first, capped) as link-relative paths.
 *  Folders are capped too — a tree of empty folders is otherwise unbounded. */
/** Folders a person's own files never live in: aindrive's bookkeeping and a
 *  teamspace's OKF backup. Skipping them keeps a listing's folder budget for
 *  the person's files. */
export const notUserFolder = (rel: string) => /(^|\/)(\.aindrive|ainmem-[^/]*)$/.test(rel);

export async function listTree(
  link: AindriveLink,
  limit = 200,
  maxDirs = 30,
  skipDir?: (rel: string) => boolean
): Promise<string[]> {
  const out: string[] = [];
  const queue = [""];
  let dirs = 0;
  while (queue.length && out.length < limit && dirs++ < maxDirs) {
    const dir = queue.shift()!;
    for (const e of await listFiles(link, dir)) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDir) {
        if (!skipDir?.(rel)) queue.push(rel);
      } else if (out.length < limit) out.push(rel);
    }
  }
  return out;
}
