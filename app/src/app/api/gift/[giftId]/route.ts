import { NextRequest, NextResponse } from "next/server";
import { getT } from "@/i18n/server";
import { b64, findGift, markUnlocked, requirementsFor, unb64, unlocked, verifyPayment, type PaymentPayload } from "@/lib/gift";
import { providerById } from "@/lib/x402";
import { recipientSettlement } from "@/lib/x402/pay";

export const dynamic = "force-dynamic";

/**
 * A gift, as an x402 v2 resource.
 *   no PAYMENT-SIGNATURE → 402, PAYMENT-REQUIRED header (base64 JSON), and the
 *                           same requirements in the body for a person to read
 *   PAYMENT-SIGNATURE     → verified (EIP-3009 over USDC, to the recipient),
 *                           settled by the provider the 402 named (family
 *                           ledger, or aindrive's x402 — lib/x402), gift
 *                           unlocked → 200 with PAYMENT-RESPONSE
 * Already unlocked → 200 without paying again.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await ctx.params;
  const found = await findGift(giftId);
  if (!found) return NextResponse.json({ error: "gift not found" }, { status: 404 });
  const { gift } = found;
  const video = `/api/gift/${encodeURIComponent(giftId)}/video`;
  if (unlocked(gift)) return NextResponse.json({ ok: true, unlocked: true, video });

  let via;
  try {
    via = await recipientSettlement(gift.spec);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
  const requirements = requirementsFor(gift.spec, via);
  const provider = providerById(via.settlement)!;
  const t = await getT();
  const resource = { url: req.nextUrl.toString(), description: t("{title} — pocket money for {name}", { title: gift.spec.title, name: gift.spec.recipientName }), mimeType: gift.spec.file.mime };
  const gate = (error: string) =>
    NextResponse.json(
      { x402Version: 2, error, accepts: [requirements], resource },
      { status: 402, headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error, resource, accepts: [requirements] }) } }
    );

  const sig = req.headers.get("PAYMENT-SIGNATURE");
  if (!sig) return gate("PAYMENT-SIGNATURE header is required");
  const payment = unb64<PaymentPayload>(sig);
  const check = await verifyPayment(payment, requirements);
  if (!check.ok) return gate(check.error);

  // a payment signed for one settlement is never settled by another
  if (String(payment!.accepted.extra?.settlement ?? "") !== provider.id) return gate(`payment was signed for a different settlement (${provider.id} expected)`);
  const payer = await provider.payerOf(payment!);
  if (!payer) return gate("the paying wallet is nobody's here");
  const settled = await provider.settle(gift.spec, payment!, payer);
  if (!settled.ok) return gate(settled.error);
  await markUnlocked(found.blockId, gift, payer, settled.receipt);
  const response = { success: true, transaction: settled.transaction ?? settled.receipt, network: settled.network ?? requirements.network, payer: check.from, settlement: provider.id };
  return NextResponse.json({ ok: true, receipt: settled.receipt, video }, { headers: { "PAYMENT-RESPONSE": b64(response) } });
}
