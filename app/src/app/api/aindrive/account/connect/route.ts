import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { startPairing } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/** POST → { pairingId, approveUrl } — open approveUrl (aindrive, where the
 *  person is signed in) and approve; then poll /api/aindrive/account/poll. */
export async function POST() {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json(await startPairing(auth.user.id));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
