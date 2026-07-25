import { NextRequest, NextResponse } from "next/server";
import { paymentQuote, serveEggTarts } from "@/lib/seller";

export const dynamic = "force-dynamic";

/**
 * Tarts&Co, the whole store.
 *
 * No payment header → 402 with the quote (the x402 shape: price, payTo,
 * network). With `X-Payment-Tx` → the payment is checked on-chain and then the
 * buyer is: the seller reads `isHumanBacked(relationId)` for the paying agent
 * and only then releases the tarts. Deliberately open to anyone — a bot is
 * welcome to pay, and will be told no.
 */
export async function GET(req: NextRequest) {
  const txHash = req.headers.get("x-payment-tx");
  if (!txHash) return NextResponse.json(paymentQuote(), { status: 402 });

  const verdict = await serveEggTarts(txHash);
  return NextResponse.json(verdict.body, { status: verdict.status });
}
