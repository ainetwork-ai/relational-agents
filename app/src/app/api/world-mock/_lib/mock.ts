import "server-only";
import { NextResponse } from "next/server";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from "jose";
import { worldConfig, type WorldConfig } from "@/lib/auth/world";

/**
 * LOCAL MOCK of World's sandbox Human Continuity IdP (sandbox.auth.world.org).
 * Same discovery shape, same flow (authorization code + PKCE S256, RS256
 * id_token with pairwise-style `sub`, nonce, auth_time) — but the "human" is
 * whoever the tester says they are. It exists because sandbox client
 * registration is HTTPS-only, and to demonstrate the deny paths (same human on
 * two accounts, cancel at the IdP). Live only when worldConfig().mode is
 * "mock"; every route 404s otherwise.
 *
 * State lives on globalThis so a dev hot reload neither rotates the signing
 * key nor drops codes mid-flow. A server restart does both — start over.
 */

export interface MockCode {
  sub: string;
  nonce: string | null;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  /** epoch seconds — when the tester "verified" */
  authTime: number;
  expiresAt: number;
}

interface MockKeys {
  privateKey: CryptoKey;
  publicJwk: JWK;
  kid: string;
}

interface MockState {
  codes: Map<string, MockCode>;
  keys: Promise<MockKeys> | null;
}

const g = globalThis as unknown as { __worldMockIdp?: MockState };
const state: MockState = (g.__worldMockIdp ??= { codes: new Map(), keys: null });

export const CODE_TTL_MS = 120_000;
export const MOCK_HUMANS = 6;

/** The mock's config, or null when the mock is not the selected IdP. */
export function mockConfig(): WorldConfig | null {
  const cfg = worldConfig();
  return cfg?.mode === "mock" ? cfg : null;
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function mockKeys(): Promise<MockKeys> {
  if (!state.keys) {
    state.keys = (async () => {
      const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
      const publicJwk = await exportJWK(publicKey);
      const kid = await calculateJwkThumbprint(publicJwk);
      return { privateKey, publicJwk, kid };
    })();
    state.keys.catch(() => (state.keys = null));
  }
  return state.keys;
}

export function issueCode(entry: Omit<MockCode, "expiresAt">): string {
  const now = Date.now();
  for (const [c, v] of state.codes) if (v.expiresAt <= now) state.codes.delete(c);
  const code = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  state.codes.set(code, { ...entry, expiresAt: now + CODE_TTL_MS });
  return code;
}

/** One-time: the code is gone after this call whether or not it was valid. */
export function consumeCode(code: string): MockCode | null {
  const entry = state.codes.get(code);
  if (!entry) return null;
  state.codes.delete(code);
  return entry.expiresAt > Date.now() ? entry : null;
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(new Uint8Array(digest)).toString("base64url");
}
