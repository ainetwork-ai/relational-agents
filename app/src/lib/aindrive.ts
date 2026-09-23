import "server-only";
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
 *   AINDRIVE_ALLOWED_DRIVES  comma-separated drive ids agents may also be linked to
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

/** Server + token from env, or null when aindrive is not configured here. */
function config(): { server: string; token: string } | null {
  const server = process.env.AINDRIVE_SERVER?.trim().replace(/\/+$/, "");
  const token = process.env.AINDRIVE_TOKEN?.trim();
  return server && token ? { server, token } : null;
}

export function aindriveConfigured(): boolean {
  return config() !== null;
}

/** The env-level default link, or null when no drive is linked. */
export function defaultLink(): AindriveLink | null {
  const driveId = process.env.AINDRIVE_DRIVE_ID?.trim();
  if (!driveId) return null;
  return { driveId, root: cleanPath(process.env.AINDRIVE_ROOT ?? "") };
}

/** Whether this deployment lets an agent be linked to `link` (see header). */
export function linkAllowed(link: AindriveLink): boolean {
  const allowed = (process.env.AINDRIVE_ALLOWED_DRIVES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(link.driveId)) return true;
  const base = defaultLink();
  if (!base || base.driveId !== link.driveId) return false;
  return !base.root || link.root === base.root || link.root.startsWith(`${base.root}/`);
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

// aindrive's /mcp is stateless, so one connected client serves every request
// until it fails; a failure drops it and the next call reconnects.
let client: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const cfg = config();
  if (!cfg) throw new AindriveError("aindrive is not configured (AINDRIVE_SERVER / AINDRIVE_TOKEN)");
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
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  client ??= connect();
  let res;
  try {
    res = await (await client).callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
  } catch (e) {
    client = null;
    throw e instanceof AindriveError ? e : new AindriveError(`aindrive ${name}: ${(e as Error).message}`);
  }
  const text = Array.isArray(res.content)
    ? res.content.map((p) => (p && p.type === "text" ? p.text : "")).join("\n")
    : "";
  if (res.isError) throw new AindriveError(`aindrive ${name}: ${text || "failed"}`);
  return res.structuredContent ?? text;
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

export async function writeFile(link: AindriveLink, rel: string, content: string): Promise<void> {
  const path = drivePath(link, rel);
  if (!path || path === link.root) throw new AindriveError("a file path inside the linked folder is required");
  await callTool("write_file", { drive_id: link.driveId, path, content, encoding: "utf8" });
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
export async function offeredDrives(): Promise<{ id: string; name: string; root: string }[]> {
  const base = defaultLink();
  return (await listDrives())
    .map((d) => ({ ...d, root: base?.driveId === d.id ? base.root : "" }))
    .filter((d) => linkAllowed({ driveId: d.id, root: d.root }));
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
export async function listTree(link: AindriveLink, limit = 200, maxDirs = 30): Promise<string[]> {
  const out: string[] = [];
  const queue = [""];
  let dirs = 0;
  while (queue.length && out.length < limit && dirs++ < maxDirs) {
    const dir = queue.shift()!;
    for (const e of await listFiles(link, dir)) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDir) queue.push(rel);
      else if (out.length < limit) out.push(rel);
    }
  }
  return out;
}
