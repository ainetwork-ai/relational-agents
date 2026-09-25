import "server-only";

/**
 * World ID 4.0 (IDKit v4), server side — the path a real Developer Portal app
 * takes. Two things changed from the 3.0 integration in worldid.ts:
 *
 *   1. rp_context is not a static value. The relying party SIGNS a fresh one
 *      for every request (nonce + created_at/expires_at, and the action hashed
 *      in for uniqueness proofs) with the Portal-issued signing key. So the
 *      client asks this server for one right before opening the widget.
 *   2. Verification forwards IDKit's result, unmodified, to
 *      developer.world.org/api/v4/verify/{rp_id}; the nullifier to store is
 *      responses[0].nullifier.
 *
 * Configured by WORLD_RP_ID (rp_…), WORLD_RP_SIGNING_KEY (hex, never sent to a
 * client), and NEXT_PUBLIC_WORLD_ID_APP_ID (app_…). Without all three, callers
 * fall back to the 3.0 cloud verifier (WORLD_ID_APP_ID) or the dev simulator —
 * and say so, since neither of those is this path.
 */

export type IdKitEnvironment = "production" | "staging" | "sandbox";
const ENVIRONMENTS: readonly string[] = ["production", "staging", "sandbox"];

export function worldIdV4Config() {
  const rpId = process.env.WORLD_RP_ID;
  const signingKey = process.env.WORLD_RP_SIGNING_KEY;
  const appId = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID;
  if (!rpId?.startsWith("rp_") || !signingKey || !appId?.startsWith("app_")) return null;
  // the simulator answers only non-production environments. A typo must not
  // quietly become some other environment — the verifier would then accept
  // proofs from a world this server did not mean to trust.
  const environment = process.env.NEXT_PUBLIC_WORLD_ID_ENV || "staging";
  if (!ENVIRONMENTS.includes(environment)) {
    console.error(`NEXT_PUBLIC_WORLD_ID_ENV="${environment}" is not production|staging|sandbox — World ID 4.0 disabled`);
    return null;
  }
  return { rpId, signingKey, appId, environment: environment as IdKitEnvironment };
}

export interface RpContextPayload {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** A freshly signed rp_context for one uniqueness request on `action`. */
export async function signRpContext(action: string): Promise<RpContextPayload | null> {
  const cfg = worldIdV4Config();
  if (!cfg) return null;
  const { signRequest } = await import("@worldcoin/idkit-core/signing");
  const key = cfg.signingKey.startsWith("0x") ? cfg.signingKey.slice(2) : cfg.signingKey;
  const sig = signRequest({ signingKeyHex: key, action, ttl: 300 });
  return {
    rp_id: cfg.rpId,
    nonce: sig.nonce,
    created_at: sig.createdAt,
    expires_at: sig.expiresAt,
    signature: sig.sig,
  };
}

/**
 * A nullifier as one canonical string: 0x + 64 lowercase hex. Seats are unique
 * on (room, nullifier) as TEXT, so "0xABC…" and "0x0abc…" for the same field
 * element would otherwise seat one human twice. null = not a 256-bit value.
 */
export function canonicalNullifier(value: string): string | null {
  try {
    const n = BigInt(value);
    if (n < BigInt(0) || n >= BigInt(2) ** BigInt(256)) return null;
    return `0x${n.toString(16).padStart(64, "0")}`;
  } catch {
    return null;
  }
}

export type V4VerifyResult =
  | {
      ok: true;
      nullifier: string;
      environment: IdKitEnvironment;
      protocolVersion: "3.0" | "4.0";
      /** the credential the proof is for: "orb" / "device" (3.0), "proof_of_human" / "passport" (4.0) */
      credential: string;
      /** what to record: the 3.0 verification level, or "world-id-4" (+ ":<credential>" beyond proof_of_human) */
      level: string;
    }
  | { ok: false; error: string };

interface IdKitResponseShape {
  protocol_version?: string;
  action?: string;
  session_id?: string;
  environment?: string;
  responses?: { identifier?: string; nullifier?: string; signal_hash?: string }[];
}

function sameField(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/**
 * Verifies an IDKit v4 result for `expectedAction` — a uniqueness proof of ONE
 * credential. Everything the Portal would take on trust from the forwarded
 * payload is pinned here first:
 *
 *   - action: a proof minted for some other trust moment is never accepted.
 *   - signal: when `opts.signal` is given, the response's signal_hash must be
 *     hashSignal(signal). IDKit fills signal_hash in on the client and the
 *     Portal checks the proof against whatever arrives — absent, it defaults
 *     to the hash of "" — so without this a proof made for one context (or
 *     none) replays into another.
 *   - environment: a staging/simulator proof is not a production human. The
 *     verifier's answer must name the environment this server is configured
 *     for (docs: "assert production for production integrations").
 */
export async function verifyIdKitV4(
  result: unknown,
  expectedAction: string,
  opts: { signal?: string } = {}
): Promise<V4VerifyResult> {
  const cfg = worldIdV4Config();
  if (!cfg) return { ok: false, error: "World ID 4.0 is not configured" };
  if (!result || typeof result !== "object") return { ok: false, error: "no IDKit result" };
  const r = result as IdKitResponseShape;
  if (r.session_id !== undefined) return { ok: false, error: "a session proof is not a uniqueness proof" };
  if (r.protocol_version !== "3.0" && r.protocol_version !== "4.0")
    return { ok: false, error: `unknown protocol version "${r.protocol_version ?? "?"}"` };
  if (r.action !== expectedAction)
    return { ok: false, error: `proof is for "${r.action ?? "?"}", not "${expectedAction}"` };
  const response = r.responses?.length === 1 ? r.responses[0] : null;
  if (!response?.identifier || !response.nullifier)
    return { ok: false, error: "expected exactly one credential response" };
  if (opts.signal !== undefined) {
    const { hashSignal } = await import("@worldcoin/idkit-core/hashing");
    if (!response.signal_hash || !sameField(response.signal_hash, hashSignal(opts.signal)))
      return { ok: false, error: "proof was not made for this context (signal mismatch)" };
  }

  const res = await fetch(`https://developer.world.org/api/v4/verify/${cfg.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    throw new Error(`World ID verifier unreachable: ${err}`);
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    nullifier?: string;
    environment?: string;
    results?: { success?: boolean; nullifier?: string }[];
    code?: string;
    detail?: string;
  };
  if (!res.ok || body.success !== true)
    return { ok: false, error: body.detail ?? body.code ?? `verifier ${res.status}` };

  const environment = body.environment ?? r.environment;
  if (environment !== cfg.environment)
    return { ok: false, error: `proof is from "${environment ?? "?"}", this server expects "${cfg.environment}"` };

  const fromResponse = canonicalNullifier(response.nullifier);
  const fromVerifier = body.nullifier ?? body.results?.[0]?.nullifier;
  const nullifier = fromVerifier ? canonicalNullifier(fromVerifier) : fromResponse;
  if (!nullifier) return { ok: false, error: "verifier returned no usable nullifier" };
  if (fromResponse && nullifier !== fromResponse)
    return { ok: false, error: "verifier and proof disagree on the nullifier" };

  const credential = response.identifier;
  const level =
    r.protocol_version === "3.0"
      ? credential
      : credential === "proof_of_human"
        ? "world-id-4"
        : `world-id-4:${credential}`;
  return {
    ok: true,
    nullifier,
    environment: cfg.environment,
    protocolVersion: r.protocol_version,
    credential,
    level,
  };
}
