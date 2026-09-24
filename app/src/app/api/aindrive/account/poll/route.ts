import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { pollPairing } from "@/lib/aindrive-account";

export const dynamic = "force-dynamic";

/** POST { pairingId } → { state: "pending" | "connected" | "expired", account? } */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as { pairingId?: unknown };
  if (typeof body.pairingId !== "string") return NextResponse.json({ error: "pairingId required" }, { status: 400 });
  try {
    const r = await pollPairing(auth.user.id, body.pairingId);
    return NextResponse.json({
      state: r.state,
      account: r.account && { email: r.account.email, name: r.account.name, expiresAt: r.account.expiresAt },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
