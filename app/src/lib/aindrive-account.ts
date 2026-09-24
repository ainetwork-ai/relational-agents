import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aindriveAccounts } from "@/lib/db/schema";
import { AindriveError, aindriveServer, hasServiceToken, runAsAindriveUser } from "@/lib/aindrive";

/**
 * A person's own aindrive account, connected from the browser session they are
 * already signed in with on aindrive.
 *
 * aindrive's device pairing (the same one `aindrive login` uses):
 *   1. we ask aindrive for a pairing link  (POST /api/auth/cli/start)
 *   2. the person opens it in their browser — signed in there already, they
 *      only press approve                    (/cli-login/<linkId>)
 *   3. we poll until approved and receive that account's session token
 *                                             (POST /api/auth/cli/poll)
 * The token is stored encrypted, per person, and every aindrive call made for
 * them runs with it (runAs) — they reach their own drives and nothing else.
 */

// ── token at rest ───────────────────────────────────────────────────────────

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new AindriveError("SESSION_SECRET is required to store aindrive accounts");
  return createHash("sha256").update(`aindrive-account:${secret}`).digest();
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function open(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null; // SESSION_SECRET changed — the account has to be connected again
  }
}

/** JWT `exp`, when the token is one (aindrive's session tokens are). */
function expiryOf(token: string): Date | null {
  try {
    const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).exp;
    return typeof exp === "number" ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

// ── the stored account ──────────────────────────────────────────────────────

export interface AindriveAccount {
  server: string;
  email: string | null;
  name: string | null;
  expiresAt: Date | null;
}

async function tokenOf(userId: string): Promise<{ account: AindriveAccount; token: string } | null> {
  const server = aindriveServer();
  if (!server) return null;
  const [row] = await db.select().from(aindriveAccounts).where(eq(aindriveAccounts.userId, userId));
  // an account on another aindrive server is not this deployment's to use
  if (!row || row.server !== server) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  const token = open(row.tokenEnc);
  if (!token) return null;
  return {
    account: { server: row.server, email: row.email, name: row.name, expiresAt: row.expiresAt },
    token,
  };
}

/** The person's connected account (without its token), or null. */
export async function getAccount(userId: string): Promise<AindriveAccount | null> {
  return (await tokenOf(userId))?.account ?? null;
}

export async function disconnectAccount(userId: string): Promise<void> {
  await db.delete(aindriveAccounts).where(eq(aindriveAccounts.userId, userId));
}

/** Runs `fn` as the person's own aindrive account. Throws when they have not
 *  connected one. */
export async function runAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const found = await tokenOf(userId);
  if (!found) throw new AindriveError("aindrive account not connected — connect aindrive first");
  return runAsAindriveUser(found.token, fn);
}

/** As the person when they have connected an account; otherwise with the
 *  deployment's service token when one is set; otherwise not at all (throws).
 *  For background work on someone's behalf (a teamspace's sync). */
export async function runAsOrService<T>(userId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const found = userId ? await tokenOf(userId) : null;
  if (found) return runAsAindriveUser(found.token, fn);
  if (hasServiceToken()) return fn();
  throw new AindriveError("aindrive account not connected — connect aindrive first");
}

// ── pairing (device approval) ───────────────────────────────────────────────

interface Pending {
  userId: string;
  server: string;
  linkId: string;
  deviceSecret: string;
  expiresAt: number;
}

// A pairing lives for minutes and only on this process; a restart mid-pairing
// means pressing connect again. Survives dev HMR via globalThis.
const PENDING_KEY = Symbol.for("app.aindrive.pairing");
function pending(): Map<string, Pending> {
  const g = globalThis as unknown as Record<symbol, Map<string, Pending>>;
  return (g[PENDING_KEY] ??= new Map());
}

async function post(server: string, path: string, body: unknown) {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

/** Starts a pairing: returns the aindrive page the person approves on. */
export async function startPairing(userId: string): Promise<{ pairingId: string; approveUrl: string; expiresAt: number }> {
  const server = aindriveServer();
  if (!server) throw new AindriveError("aindrive is not configured (AINDRIVE_SERVER)");
  // names this app on aindrive's approval page (older aindrive ignores it and
  // shows its CLI wording)
  const clientName = (process.env.AINDRIVE_CLIENT_NAME || "ainmem").slice(0, 40);
  const { status, data } = await post(server, "/api/auth/cli/start", { client_name: clientName });
  const linkId = typeof data.linkId === "string" ? data.linkId : "";
  const deviceSecret = typeof data.deviceSecret === "string" ? data.deviceSecret : "";
  if (status >= 400 || !linkId || !deviceSecret) throw new AindriveError(`aindrive pairing could not start (${status})`);
  const ttl = typeof data.expiresInSec === "number" ? data.expiresInSec * 1000 : 10 * 60 * 1000;
  const now = Date.now();
  for (const [id, p] of pending()) if (p.expiresAt < now || p.userId === userId) pending().delete(id);
  const pairingId = randomUUID();
  const expiresAt = now + ttl;
  pending().set(pairingId, { userId, server, linkId, deviceSecret, expiresAt });
  const base = (process.env.AINDRIVE_PUBLIC_URL || server).replace(/\/+$/, "");
  return { pairingId, approveUrl: `${base}/cli-login/${encodeURIComponent(linkId)}`, expiresAt };
}

export type PairingState = "pending" | "connected" | "expired";

/** Checks a pairing once. On approval the account is stored for the person. */
export async function pollPairing(userId: string, pairingId: string): Promise<{ state: PairingState; account?: AindriveAccount }> {
  const p = pending().get(pairingId);
  if (!p || p.userId !== userId || p.expiresAt < Date.now()) {
    pending().delete(pairingId);
    return { state: "expired" };
  }
  const { status, data } = await post(p.server, "/api/auth/cli/poll", { linkId: p.linkId, deviceSecret: p.deviceSecret });
  if (status === 202) return { state: "pending" };
  pending().delete(pairingId);
  const token = typeof data.token === "string" ? data.token : "";
  if (status >= 400 || !token) return { state: "expired" };
  const user = (data.user ?? {}) as { email?: unknown; name?: unknown };
  const row = {
    server: p.server,
    tokenEnc: seal(token),
    email: typeof user.email === "string" ? user.email : null,
    name: typeof user.name === "string" ? user.name : null,
    expiresAt: expiryOf(token),
    updatedAt: new Date(),
  };
  await db
    .insert(aindriveAccounts)
    .values({ userId, ...row })
    .onConflictDoUpdate({ target: aindriveAccounts.userId, set: row });
  return { state: "connected", account: { server: row.server, email: row.email, name: row.name, expiresAt: row.expiresAt } };
}
