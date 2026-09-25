import { NextRequest, NextResponse } from "next/server";
import {
  b64,
  findGift,
  ledgerDriveOf,
  markUnlocked,
  requirementsFor,
  settle,
  unb64,
  unlocked,
  userByWallet,
  verifyPayment,
  type PaymentPayload,
} from "@/lib/gift";

export const dynamic = "force-dynamic";

/**
 * A gift, as an x402 v2 resource.
 *   no PAYMENT-SIGNATURE → 402, PAYMENT-REQUIRED header (base64 JSON), and the
 *                           same requirements in the body for a person to read
 *   PAYMENT-SIGNATURE     → verified (EIP-3009 over USDC, to the recipient),
 *                           settled in the family ledger, gift unlocked →
 *                           200 with PAYMENT-RESPONSE
 * Already unlocked → 200 without paying again.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await ctx.params;
  const found = await findGift(giftId);
  if (!found) return NextResponse.json({ error: "gift not found" }, { status: 404 });
  const { gift } = found;
  const video = `/api/gift/${encodeURIComponent(giftId)}/video`;
  if (unlocked(gift)) return NextResponse.json({ ok: true, unlocked: true, video });

  const requirements = requirementsFor(gift.spec);
  const resource = { url: req.nextUrl.toString(), description: `${gift.spec.title} — ${gift.spec.recipientName}에게 용돈`, mimeType: gift.spec.file.mime };
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

  const payer = await userByWallet(check.from);
  if (!payer) return gate("the paying wallet is not a family wallet here");
  const payerDrive = await ledgerDriveOf(payer.id);
  if (!payerDrive) return gate("the payer has no aindrive device for the ledger");
  const settled = await settle(gift.spec, payment!, { userId: payer.id, name: payer.displayName, driveId: payerDrive }, gift.spec.file.driveId);
  if ("error" in settled) return gate(settled.error);
  await markUnlocked(found.blockId, gift, { userId: payer.id, name: payer.displayName }, settled.receipt);
  const response = { success: true, transaction: settled.receipt, network: requirements.network, payer: check.from, settlement: "family-ledger" };
  return NextResponse.json({ ok: true, receipt: settled.receipt, video }, { headers: { "PAYMENT-RESPONSE": b64(response) } });
}
