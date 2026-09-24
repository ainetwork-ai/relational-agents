import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { aindriveConfigured } from "@/lib/aindrive";
import { startPairing } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/**
 * POST → { pairingId, approveUrl, expiresAt } — "aindrive로 로그인".
 * Open approveUrl (aindrive, where the person is signed in already) and
 * approve; then poll /api/auth/aindrive/poll. The pairing is tied to this
 * browser's session, so no one else can finish it.
 */
export async function POST() {
  if (!aindriveConfigured())
    return NextResponse.json({ error: "aindrive sign-in is not configured on this server" }, { status: 503 });
  try {
    const started = await startPairing(null);
    const session = await getSession();
    session.aindrivePairing = started.pairingId;
    await session.save();
    return NextResponse.json(started);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
