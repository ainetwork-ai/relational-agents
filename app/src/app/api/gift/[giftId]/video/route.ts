import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { canSeeGift, findGift, giftBytes, unlocked } from "@/lib/gift";

export const dynamic = "force-dynamic";

/** GET → the gift's file, once paid for: read from the maker's own device as
 *  them (the folder is not shared — this is the only way in). The maker can
 *  always watch their own. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { giftId } = await ctx.params;
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(auth.user.id, found.workspaceId)))
    return NextResponse.json({ error: "gift not found" }, { status: 404 });
  const { gift } = found;
  if (!unlocked(gift) && gift.spec.recipientUserId !== auth.user.id)
    return NextResponse.json({ error: "payment required" }, { status: 402 });
  const bytes = await giftBytes(gift.spec);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": gift.spec.file.mime, "content-length": String(bytes.length), "cache-control": "private, max-age=3600" },
  });
}
