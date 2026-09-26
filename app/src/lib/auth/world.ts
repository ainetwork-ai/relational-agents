import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * World ID (Human Continuity IdP) — OIDC authorization-code + PKCE. The IdP
 * hands back a PAIRWISE `sub`: a stable private identifier for the human
 * behind the account, different per client, so verifying tells us "which
 * unique human" without learning who they are.
 *
 * The treasury counts DISTINCT subs for its quorums — accounts are cheap,
 * humans are not. Every approval is a fresh step-up (max_age=0, prompt=login),
 * and the id_token's nonce ties the result to the one request that asked.
 *
 * Two IdPs, one code path (endpoints always come from discovery):
 *   sandbox — the event sandbox (https://sandbox.auth.world.org). Identities
 *             there are mocked by World; still not production.
 *   mock    — /api/world-mock, a LOCAL mock of the sandbox with the same
 *             discovery shape. Client registration is HTTPS-only, so localhost
 *             cannot iterate against the real one; the mock also lets a tester
 *             pick "which human" to demonstrate the same-human deny paths.
 *
 * WORLD_IDP picks one. Default: sandbox when WORLD_CLIENT_ID is set, else the
 * mock outside production, else disabled. In production the mock only runs
 * when WORLD_IDP=mock is set on purpose — anyone can claim any human there.
 */

export type WorldIdpMode = "sandbox" | "mock";

export interface WorldConfig {
  mode: WorldIdpMode;
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const MOCK_CLIENT_ID = "mock-client";
export const MOCK_CLIENT_SECRET = "mock-secret";

function selectedMode(): WorldIdpMode | null {
  const explicit = process.env.WORLD_IDP;
  if (explicit === "sandbox" || explicit === "mock") return explicit;
  if (process.env.WORLD_CLIENT_ID) return "sandbox";
  return process.env.NODE_ENV === "production" ? null : "mock";
}

/** null = no IdP configured (sandbox chosen but its client is not registered). */
export function worldConfig(): WorldConfig | null {
  const mode = selectedMode();
  if (mode === "sandbox") {
    const clientId = process.env.WORLD_CLIENT_ID;
    const clientSecret = process.env.WORLD_CLIENT_SECRET;
    const redirectUri = process.env.WORLD_REDIRECT_URI; // must be HTTPS (portal rule)
    if (!clientId || !clientSecret || !redirectUri) return null;
    return {
      mode,
      issuer: (process.env.WORLD_ISSUER ?? "https://sandbox.auth.world.org").replace(/\/+$/, ""),
      clientId,
      clientSecret,
      redirectUri,
    };
  }
  if (mode === "mock") {
    const redirectUri =
      process.env.WORLD_REDIRECT_URI ??
      `http://localhost:${process.env.PORT || 36625}/api/auth/world/callback`;
    return {
      mode,
      issuer: `${new URL(redirectUri).origin}/api/world-mock`,
      clientId: MOCK_CLIENT_ID,
      clientSecret: MOCK_CLIENT_SECRET,
      redirectUri,
    };
  }
  return null;
}

/** For the treasury status API: where a step-up would go right now. */
export function idpMode(): WorldIdpMode | null {
  return worldConfig()?.mode ?? null;
}

/**
 * Absolute URL for a redirect back into the app. Built from the configured
 * redirect URI's origin, not req.url (inside the container req.url carries the
 * bind address — see api/auth/google/callback). `fallback` is used only when
 * no IdP is configured.
 */
export function worldSiteUrl(path: string, fallback: string): URL {
  const redirectUri = worldConfig()?.redirectUri ?? process.env.WORLD_REDIRECT_URI;
  return new URL(path, redirectUri ? new URL(redirectUri).origin : fallback);
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** PKCE pair: verifier (kept in a short-lived cookie) + S256 challenge. */
export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** Random url-safe token for state / nonce. */
export function randomToken(bytes = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export const newNonce = () => randomToken(16);

// ── discovery ───────────────────────────────────────────────────────────────

export interface WorldDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

const discoveryCache = new Map<string, Promise<WorldDiscovery>>();

export function worldDiscovery(cfg: WorldConfig): Promise<WorldDiscovery> {
  let hit = discoveryCache.get(cfg.issuer);
  if (!hit) {
    hit = (async () => {
      // A cold cache right after a container start has met a resolver that is
      // not ready yet ("fetch failed", EAI_AGAIN) and turned a member's step-up
      // into "World ID isn't reachable". Three tries, a second apart, before
      // giving up — the document is static, so retrying costs nothing.
      let res: Response | null = null;
      for (let attempt = 1; ; attempt++) {
        try {
          res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, { cache: "no-store" });
          break;
        } catch (err) {
          if (attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (!res.ok) throw new Error(`world discovery failed: ${res.status}`);
      const doc = (await res.json()) as WorldDiscovery;
      if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri)
        throw new Error("world discovery is missing endpoints");
      // OIDC Discovery §4.3: the document must name the issuer we asked.
      if (String(doc.issuer ?? "").replace(/\/+$/, "") !== cfg.issuer)
        throw new Error(`world discovery issuer mismatch: ${doc.issuer} ≠ ${cfg.issuer}`);
      return doc;
    })();
    discoveryCache.set(cfg.issuer, hit);
    // a failed fetch must not stick — the next request retries
    hit.catch(() => discoveryCache.delete(cfg.issuer));
  }
  return hit;
}

/** Network-level failures: nothing reached the other side, so a retry cannot double anything. */
function isConnectFailure(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } } | null)?.cause;
  const codes = [cause?.code, ...(cause?.errors ?? []).map((e) => e.code)].filter(Boolean) as string[];
  if ((err as { name?: string } | null)?.name === "TimeoutError") return true;
  return codes.some((c) => /^(ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT)$/.test(c));
}

const CONNECT_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 8000;

async function fetchWithConnectRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
    } catch (err) {
      if (attempt >= CONNECT_ATTEMPTS || !isConnectFailure(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

/** Verifying an id_token is idempotent, so a JWKS fetch that never connected is simply tried again. */
async function verifyWithRetry(token: string, jwksUri: string, options: Parameters<typeof jwtVerify>[2]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await jwtVerify(token, jwksFor(jwksUri), options);
    } catch (err) {
      if (attempt >= CONNECT_ATTEMPTS || !isConnectFailure(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ── code exchange ───────────────────────────────────────────────────────────

/**
 * How this client authenticates at the token endpoint. Discovery lists what
 * the IdP supports; a registered client has ONE method, and a strict IdP
 * answers invalid_client to any other. WORLD_TOKEN_AUTH_METHOD pins it to what
 * the registration output names; unset, client_secret_basic (the default for a
 * registered client, RFC 7591 §2) whenever the IdP offers it.
 */
function tokenAuthMethod(disco: WorldDiscovery): "client_secret_basic" | "client_secret_post" {
  const pinned = process.env.WORLD_TOKEN_AUTH_METHOD;
  if (pinned === "client_secret_basic" || pinned === "client_secret_post") return pinned;
  const methods = disco.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  return methods.includes("client_secret_basic") || !methods.includes("client_secret_post")
    ? "client_secret_basic"
    : "client_secret_post";
}

export interface WorldIdentity {
  /** pairwise subject — the human, as this client sees them */
  sub: string;
  /** when the human actually authenticated at the IdP (epoch seconds) */
  authTime: number | null;
  /** when the id_token was minted (epoch seconds) */
  issuedAt: number | null;
}

/**
 * Exchange the code and validate the ID token — the ONLY place a World result
 * becomes trusted. Checks signature (discovery JWKS), iss, aud, exp, and that
 * the nonce is the one this browser's flow generated. Freshness against a
 * specific treasury action (auth_time after its creation) is the caller's
 * check — recordIdpApproval.
 */
export async function exchangeWorldCode(code: string, verifier: string, expectedNonce: string): Promise<WorldIdentity> {
  const cfg = worldConfig();
  if (!cfg) throw new Error("World IdP is not configured");
  if (!expectedNonce) throw new Error("world flow has no nonce");
  const disco = await worldDiscovery(cfg);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (tokenAuthMethod(disco) === "client_secret_post") {
    body.set("client_id", cfg.clientId);
    body.set("client_secret", cfg.clientSecret);
  } else {
    // RFC 6749 §2.3.1: form-encode each half before base64
    const basic = `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`;
    headers.authorization = `Basic ${Buffer.from(basic).toString("base64")}`;
  }

  // The code is single-use, so only a failure that never reached the IdP is
  // retried: a connect that timed out or was refused (this host's container
  // egress drops for tens of seconds while other stacks redeploy). A response,
  // any response, ends the attempts — a lost reply would surface as
  // invalid_grant on retry and fail cleanly, never as two approvals.
  const res = await fetchWithConnectRetry(disco.token_endpoint, { method: "POST", headers, body, cache: "no-store" });
  if (!res.ok) throw new Error(`world token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("world token response had no id_token");

  const algs = (disco.id_token_signing_alg_values_supported ?? ["RS256"]).filter((a) => a !== "none");
  const { payload } = await verifyWithRetry(tokens.id_token, disco.jwks_uri, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: algs,
    clockTolerance: 30, // our clock vs World's; the token lives minutes
  });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("world id_token had no sub");
  if (payload.nonce !== expectedNonce) throw new Error("world id_token nonce mismatch");
  return {
    sub: payload.sub,
    authTime: typeof payload.auth_time === "number" ? payload.auth_time : null,
    issuedAt: typeof payload.iat === "number" ? payload.iat : null,
  };
}
