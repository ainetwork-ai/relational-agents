import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { canSeeGift, findGift, payGift } from "@/lib/gift";
import { announceGift } from "@/lib/gift-announce";

export const dynamic = "force-dynamic";

/** POST → the signed-in person pays for the gift from their family wallet
 *  (the "용돈으로 열기" button). The x402 round trip runs server-side. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { giftId } = await ctx.params;
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(auth.user.id, found.workspaceId)))
    return NextResponse.json({ error: "gift not found" }, { status: 404 });
  if (found.gift.spec.recipientUserId === auth.user.id)
    return NextResponse.json({ error: "자기 영상은 용돈 없이 볼 수 있어요" }, { status: 400 });
  const r = await payGift(auth.user.id, giftId, req.nextUrl.origin);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.already) await announceGift(found.workspaceId, auth.user.id, r.spec, r.receipt).catch(() => {});
  return NextResponse.json({ ok: true, receipt: r.receipt, unlock: r.unlock });
}
