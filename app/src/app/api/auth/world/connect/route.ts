import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { worldConfig, worldDiscovery, worldSiteUrl, pkcePair, randomToken, newNonce } from "@/lib/auth/world";
import { safeReturnTo } from "@/lib/auth/return-to";
import { db } from "@/lib/db";
import { chatRoomMembers, treasuryActions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/auth/world/connect?action=<treasuryActionId>&returnTo=<path>
 *
 * Step-up to World ID: sends the signed-in member to the Human Continuity IdP.
 *   - with `action`: an APPROVAL of that pending treasury action. The callback
 *     hands the verified pairwise sub to recordIdpApproval.
 *   - without: a plain verification — the callback binds the sub to this
 *     account (users.worldSub).
 * max_age=0 + prompt=login: the approval must be a verification made NOW, not
 * a session the IdP remembers. `returnTo` brings the person back to the moment
 * that asked for trust (the room, the approval card).
 *
 * Every world_* cookie is (re)written here, including clearing world_action on
 * a plain verification — a stale one from an abandoned approval must not turn
 * the next plain verification into an approval.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const params = req.nextUrl.searchParams;
  const actionId = params.get("action") || null;
  const returnTo = safeReturnTo(params.get("returnTo")) ?? "/";
  const back = (value: string) => {
    const url = worldSiteUrl(returnTo, req.url);
    url.searchParams.set(actionId ? "treasury" : "world", value);
    return NextResponse.redirect(url);
  };

  const cfg = worldConfig();
  if (!cfg) return back("unavailable");

  if (actionId) {
    if (!UUID_RE.test(actionId)) return back("not-allowed");
    const [action] = await db
      .select({ roomId: treasuryActions.roomId, status: treasuryActions.status })
      .from(treasuryActions)
      .where(eq(treasuryActions.id, actionId))
      .limit(1);
    if (!action || action.status !== "pending") return back("not-allowed");
    const [member] = await db
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.roomId, action.roomId), eq(chatRoomMembers.userId, auth.user.id)))
      .limit(1);
    if (!member) return back("not-allowed");
  }

  let authorizationEndpoint: string;
  try {
    authorizationEndpoint = (await worldDiscovery(cfg)).authorization_endpoint;
  } catch (err) {
    console.error("world discovery failed:", err);
    return back("unavailable");
  }

  const { verifier, challenge } = await pkcePair();
  const state = randomToken(16);
  const nonce = newNonce();

  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("max_age", "0");
  url.searchParams.set("prompt", "login");

  const res = NextResponse.redirect(url);
  // short-lived, HttpOnly, scoped to /api/auth/world: the callback reads them
  // once and clears them. Secure only where the browser would keep it (https
  // or production) — a Secure cookie on http://localhost is silently dropped.
  const cookie = {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/world",
    maxAge: 600,
  };
  res.cookies.set("world_pkce", verifier, cookie);
  res.cookies.set("world_state", state, cookie);
  res.cookies.set("world_nonce", nonce, cookie);
  // who started the flow — a demo login switch mid-flow must not bind this
  // person's proof to whichever account is signed in when it comes back
  res.cookies.set("world_uid", auth.user.id, cookie);
  res.cookies.set("world_return", returnTo, cookie);
  if (actionId) res.cookies.set("world_action", actionId, cookie);
  else res.cookies.set("world_action", "", { ...cookie, maxAge: 0 });
  return res;
}
