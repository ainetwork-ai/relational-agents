import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * World ID (Human Continuity IdP) — OIDC authorization-code + PKCE against
 * the event sandbox. The IdP hands back a PAIRWISE `sub`: a stable private
 * identifier for the human behind the account, different per client, so
 * verifying tells us "which unique human" without learning who they are.
 *
 * The treasury flow counts DISTINCT subs for its quorums — accounts are
 * cheap, humans are not.
 *
 * Sandbox note (event): identities are mocked; do not treat as production.
 */

const ISSUER = process.env.WORLD_ISSUER ?? "https://sandbox.auth.world.org";

export function worldConfig() {
  const clientId = process.env.WORLD_CLIENT_ID;
  const clientSecret = process.env.WORLD_CLIENT_SECRET;
  const redirectUri = process.env.WORLD_REDIRECT_URI; // must be HTTPS (portal rule)
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    issuer: ISSUER,
    authorizationEndpoint: `${ISSUER}/api/v1/authorize`,
    tokenEndpoint: `${ISSUER}/api/v1/token`,
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
    clientId,
    clientSecret,
    redirectUri,
  };
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

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

/** Exchange the code and validate the ID token — the ONLY place a World
 *  result becomes trusted. Client responses are never authorization. */
export async function exchangeWorldCode(code: string, verifier: string) {
  const cfg = worldConfig();
  if (!cfg) throw new Error("World IdP is not configured");
  const res = await fetch(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`world token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("world token response had no id_token");

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
  });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("world id_token had no sub");
  return { sub: payload.sub, authTime: typeof payload.auth_time === "number" ? payload.auth_time : null };
}
