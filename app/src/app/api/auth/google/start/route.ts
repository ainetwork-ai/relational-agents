import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { authorizeUrl, googleConfig } from "@/lib/auth/google";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/start → 302 to Google's consent screen.
 *
 * A plain navigation, not fetch: the login page links straight here, so the
 * sign-in button works with no client-side JavaScript at all.
 */
export async function GET() {
  const cfg = googleConfig();
  if (!cfg)
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 });

  // CSRF guard: Google echoes `state` back to the callback, and the callback
  // only accepts it if it matches what this request put in the session. Without
  // it, anyone could feed our callback a code obtained in their own browser and
  // log the victim into the attacker's account.
  const state = randomBytes(24).toString("hex");
  const session = await getSession();
  session.oauthState = state;
  await session.save();

  return NextResponse.redirect(authorizeUrl(cfg, state));
}
