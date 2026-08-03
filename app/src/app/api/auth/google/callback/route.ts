import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { ensureWorkspace } from "@/lib/auth/provision";
import { exchangeCode, googleConfig, type GoogleIdentity } from "@/lib/auth/google";

export const dynamic = "force-dynamic";

/** Every failure lands the visitor back on /login with a reason in the URL. */
function back(req: NextRequest, reason: string) {
  const url = new URL("/login", req.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

/**
 * Find the account this Google identity belongs to, or make one.
 *
 * `sub` is the stable key — an account can change its email address, and if we
 * keyed on email alone that person would come back as a stranger. Email is the
 * fallback so that a row created by an email-based path (page_invites) gets
 * adopted by the first Google sign-in instead of colliding with it.
 */
async function upsertUser(id: GoogleIdentity) {
  const [bySub] = await db.select().from(users).where(eq(users.googleSub, id.sub)).limit(1);
  if (bySub) {
    // Keep email and avatar current; leave displayName alone — the user may
    // have renamed themselves in-app and Google should not overwrite that.
    if (bySub.email !== id.email || (!bySub.avatarUrl && id.picture)) {
      const [updated] = await db
        .update(users)
        .set({ email: id.email, avatarUrl: bySub.avatarUrl ?? id.picture ?? null })
        .where(eq(users.id, bySub.id))
        .returning();
      return updated ?? bySub;
    }
    return bySub;
  }

  const [byEmail] = await db.select().from(users).where(eq(users.email, id.email)).limit(1);
  if (byEmail) {
    const [claimed] = await db
      .update(users)
      .set({ googleSub: id.sub, avatarUrl: byEmail.avatarUrl ?? id.picture ?? null })
      .where(eq(users.id, byEmail.id))
      .returning();
    return claimed ?? byEmail;
  }

  const [created] = await db
    .insert(users)
    .values({
      googleSub: id.sub,
      email: id.email,
      displayName: id.name?.trim() || id.email.split("@")[0],
      avatarUrl: id.picture ?? null,
    })
    .returning();
  return created;
}

/** GET /api/auth/google/callback?code=…&state=… — Google sends the visitor here. */
export async function GET(req: NextRequest) {
  const cfg = googleConfig();
  if (!cfg) return back(req, "not_configured");

  const params = req.nextUrl.searchParams;
  // The user pressed "cancel" on the consent screen, or Google refused.
  if (params.get("error")) return back(req, "cancelled");

  const code = params.get("code");
  const state = params.get("state");
  const session = await getSession();
  const expected = session.oauthState;
  // Single use: whether this succeeds or fails, the state cannot be replayed.
  session.oauthState = undefined;
  await session.save();

  if (!code || !state || !expected || state !== expected) return back(req, "bad_state");

  try {
    const identity = await exchangeCode(cfg, code);
    if (!identity.emailVerified) return back(req, "email_unverified");

    const user = await upsertUser(identity);
    session.userId = user.id;
    await session.save();

    // First sign-in has nowhere to land otherwise — same guarantee the wallet
    // logins gave (lib/auth/provision.ts).
    await ensureWorkspace(user.id, user.displayName);

    return NextResponse.redirect(new URL("/", req.url));
  } catch (err) {
    // The reason (redirect_uri_mismatch, invalid_client, …) belongs in the
    // server log, not in a query string on a public page.
    console.error("google sign-in failed:", err);
    return back(req, "signin_failed");
  }
}
