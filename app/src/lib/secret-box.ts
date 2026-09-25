import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Secrets at rest and tamper-proof stamps, both keyed off SESSION_SECRET with
 * a per-use label, so a value made for one purpose never opens another.
 */
function keyFor(label: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return createHash("sha256").update(`${label}:${secret}`).digest();
}

export function seal(label: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(label), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(label: string, sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = createDecipheriv("aes-256-gcm", keyFor(label), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A stamp only this server can make: HMAC of `data` under `label`. */
export function stamp(label: string, data: string): string {
  return createHmac("sha256", keyFor(label)).update(data).digest("base64url");
}

export function stampOk(label: string, data: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const want = Buffer.from(stamp(label, data));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}
