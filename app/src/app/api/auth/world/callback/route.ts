import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { exchangeWorldCode, worldSiteUrl } from "@/lib/auth/world";
import { safeReturnTo } from "@/lib/auth/return-to";
import { recordIdpApproval } from "@/lib/agent/treasury/approvals";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const WORLD_COOKIES = ["world_pkce", "world_state", "world_nonce", "world_uid", "world_action", "world_return"];

/** Postgres error code, looking through drizzle's DrizzleQueryError wrapper. */
function pgCode(err: unknown): string | undefined {
  for (let e = err, depth = 0; e && typeof e === "object" && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * GET /api/auth/world/callback?code=…&state=… — the IdP sends the browser here.
 *
 * Checklist, in order: signed in · IdP error (the person cancelled) · state ·
 * the account that STARTED the flow is the one signed in now · code exchange
 * (signature, iss, aud, exp, nonce) · one-time cookies cleared · returnTo
 * re-validated. Only then does the sub count for anything:
 *   - world_action set → recordIdpApproval (freshness against the action,
 *     seat, distinct human, quorum, execution are decided there)
 *     → ?treasury=executed | approved | <ApprovalResult reason>
 *   - otherwise → bind the sub to this account
 *     → ?world=verified | same-human | mismatch
 * Failures before that land as ?treasury=… / ?world=… cancelled | idp-error |
 * bad-state | account-switched | verify-failed.
 */
export async function GET(req: NextRequest) {
  const jar = req.cookies;
  const actionId = jar.get("world_action")?.value || null;
  const returnTo = safeReturnTo(jar.get("world_return")?.value) ?? "/";
  const key = actionId ? "treasury" : "world";

  const clear = <T extends NextResponse>(res: T) => {
    for (const name of WORLD_COOKIES) res.cookies.set(name, "", { path: "/api/auth/world", maxAge: 0, httpOnly: true });
    return res;
  };
  const done = (value: string) => {
    const url = worldSiteUrl(returnTo, req.url);
    url.searchParams.set(key, value);
    return clear(NextResponse.redirect(url));
  };

  const auth = await requireAuth();
  if (auth.error) return clear(auth.error);

  const params = req.nextUrl.searchParams;
  const idpError = params.get("error");
  if (idpError) {
    if (idpError !== "access_denied") console.warn("world idp returned error:", idpError, params.get("error_description"));
    return done(idpError === "access_denied" ? "cancelled" : "idp-error");
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = jar.get("world_state")?.value;
  const verifier = jar.get("world_pkce")?.value;
  const nonce = jar.get("world_nonce")?.value;
  if (!code || !state || !expectedState || state !== expectedState || !verifier || !nonce) return done("bad-state");

  if (jar.get("world_uid")?.value !== auth.user.id) return done("account-switched");

  let identity: Awaited<ReturnType<typeof exchangeWorldCode>>;
  try {
    identity = await exchangeWorldCode(code, verifier, nonce);
  } catch (err) {
    // the reason (invalid_grant, nonce mismatch, bad signature) belongs in the
    // server log, not in a query string
    console.error("world verification failed:", err);
    return done("verify-failed");
  }

  if (actionId) {
    try {
      const result = await recordIdpApproval({
        actionId,
        userId: auth.user.id,
        sub: identity.sub,
        authTime: identity.authTime,
        issuedAt: identity.issuedAt,
      });
      return done(result.ok ? (result.executed ? "executed" : "approved") : result.reason);
    } catch (err) {
      console.error("treasury approval failed:", err);
      return done("error");
    }
  }

  // plain verification: this account is backed by this human
  if (auth.user.worldSub && auth.user.worldSub !== identity.sub) return done("mismatch");
  try {
    await db
      .update(users)
      .set({ worldSub: identity.sub, worldVerifiedAt: new Date() })
      .where(eq(users.id, auth.user.id));
  } catch (err) {
    // users.world_sub is unique: this human already vouches for another account
    if (pgCode(err) === "23505") return done("same-human");
    console.error("world bind failed:", err);
    return done("error");
  }
  return done("verified");
}
