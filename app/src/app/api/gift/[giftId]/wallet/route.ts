import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { canSeeGift, findGift, markUnlocked, unlocked } from "@/lib/gift";
import { announceGift } from "@/lib/gift-announce";
import { paySale, quoteSale } from "@/lib/x402/aindrive-share";

export const dynamic = "force-dynamic";

/**
 * A gift sold as an aindrive paid share, paid from the signed-in person's own
 * browser wallet (lib/x402/aindrive-share):
 *
 *   GET  → { paymentRequired, accepts } — aindrive's 402, for the wallet to sign
 *   POST { paymentSignature } → aindrive settles real USDC on chain; on its
 *        200 + txHash the gift is unlocked for the family → { unlock }
 */
async function gate(giftId: string) {
  const auth = await requireAuth();
  if ("error" in auth) return { error: auth.error };
  const found = await findGift(giftId);
  if (!found || !(await canSeeGift(auth.user.id, found.workspaceId)))
    return { error: NextResponse.json({ error: "gift not found" }, { status: 404 }) };
  const sale = found.gift.spec.sale;
  if (!sale) return { error: NextResponse.json({ error: "this gift is not sold through aindrive" }, { status: 400 }) };
  if (found.gift.spec.recipientUserId === auth.user.id)
    return { error: NextResponse.json({ error: (await getT())("You can watch your own video without pocket money") }, { status: 400 }) };
  return { user: auth.user, found, sale };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const g = await gate((await ctx.params).giftId);
  if ("error" in g) return g.error;
  if (unlocked(g.found.gift)) return NextResponse.json({ unlock: g.found.gift.unlock });
  const q = await quoteSale(g.sale);
  if (!q.ok) return NextResponse.json({ error: q.error }, { status: q.status });
  return NextResponse.json({ paymentRequired: q.paymentRequired, accepts: q.accepts, messages: q.messages });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const g = await gate((await ctx.params).giftId);
  if ("error" in g) return g.error;
  if (unlocked(g.found.gift)) return NextResponse.json({ unlock: g.found.gift.unlock, already: true });
  const { paymentSignature } = ((await req.json().catch(() => ({}))) ?? {}) as { paymentSignature?: unknown };
  if (typeof paymentSignature !== "string" || !paymentSignature || paymentSignature.length > 8192)
    return NextResponse.json({ error: "paymentSignature required" }, { status: 400 });
  const paid = await paySale(g.sale, paymentSignature);
  if (!paid.ok) {
    // aindrive words a failed on-chain check (most often: not enough USDC) as "facilitator unavailable"
    const t = await getT();
    const error = /facilitator unavailable/i.test(paid.error)
      ? t("The payment didn't go through. Check that this wallet holds at least {price} on Base, then try again.", { price: `${g.sale.price} ${g.sale.currency}` })
      : paid.error;
    return NextResponse.json({ error }, { status: paid.status });
  }
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, g.user.id));
  const unlock = await markUnlocked(g.found.blockId, g.found.gift, { userId: g.user.id, name: u?.name ?? "" }, paid.txHash);
  await announceGift(g.found.workspaceId, g.user.id, g.found.gift.spec, paid.txHash).catch(() => {});
  return NextResponse.json({ unlock, txHash: paid.txHash });
}
