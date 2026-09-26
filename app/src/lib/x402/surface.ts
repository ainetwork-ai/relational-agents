import "server-only";
import { canSeeGift, findGift, formatUsdc, type GiftContent } from "@/lib/gift";
import type { T } from "@/i18n";
import { giftSurface, type A2uiMessage, type GiftSurfaceInput } from "./a2ui";
import { recipientSettlement } from "./pay";

/** The gift's A2UI surface as `viewerId` sees it, or null when they may not.
 *  `t` picks the surface language — pass `await getT()` in a request. */
export async function giftSurfaceFor(giftId: string, viewerId: string, t: T, error?: string): Promise<A2uiMessage[] | null> {
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(viewerId, found.workspaceId))) return null;
  return giftSurface(await giftSurfaceInput(found.gift, viewerId, error), t);
}

export async function giftSurfaceInput(gift: GiftContent, viewerId: string, error?: string): Promise<GiftSurfaceInput> {
  const { spec } = gift;
  const settlement = await recipientSettlement(spec).then((v) => v.settlement).catch(() => "unavailable");
  return {
    id: spec.id,
    title: spec.title,
    recipientName: spec.recipientName,
    amountKrw: spec.amountKrw,
    sale: spec.sale ? { price: spec.sale.price, currency: spec.sale.currency } : undefined,
    usdc: formatUsdc(spec.amount),
    settlement,
    previewUrl: spec.previewUrl,
    videoUrl: `/api/gift/${encodeURIComponent(spec.id)}/video`,
    unlock: gift.unlock ? { byName: gift.unlock.byName, receipt: gift.unlock.receipt, at: gift.unlock.at } : null,
    mine: spec.recipientUserId === viewerId,
    error,
  };
}
