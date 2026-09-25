import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { worldConfig, pkcePair, b64url } from "@/lib/auth/world";
import { safeReturnTo } from "@/lib/auth/return-to";

export const dynamic = "force-dynamic";

/**
 * Step-up to World ID: sends the signed-in member to the Human Continuity IdP.
 * On return, /api/auth/world/callback binds the pairwise sub to this account.
 * `returnTo` brings the person back to the moment that asked for trust
 * (a treasury approval, a room), not to a generic landing page.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const cfg = worldConfig();
  if (!cfg) return NextResponse.json({ error: "World IdP not configured (WORLD_CLIENT_ID/SECRET/REDIRECT_URI)" }, { status: 501 });

  const { verifier, challenge } = await pkcePair();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo")) ?? "/";

  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url);
  // short-lived, HttpOnly: the callback needs these once, then they die
  const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/api/auth/world", maxAge: 600 };
  res.cookies.set("world_pkce", verifier, cookie);
  res.cookies.set("world_state", state, cookie);
  res.cookies.set("world_return", returnTo, cookie);
  return res;
}
