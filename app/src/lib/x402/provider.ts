import "server-only";
import type { Hex } from "viem";
import type { GiftSpec, PaymentPayload, PaymentRequirements } from "@/lib/gift";

/**
 * Where an x402 payment is signed and settled.
 *
 * The wire (402 → PAYMENT-REQUIRED → PAYMENT-SIGNATURE → PAYMENT-RESPONSE) is
 * fixed and lives in lib/gift and the gift routes. What varies is who holds
 * the payer's wallet and who moves the money — that is a provider:
 *
 *   family-ledger  a key this server keeps per person; settlement is two CSV
 *                  rows in the family's own aindrive (today's demo)
 *   aindrive       the person's aindrive account holds the wallet and runs
 *                  the facilitator, reached over aindrive's MCP tools — the
 *                  moment aindrive offers them, payments settle for real
 *
 * A provider is chosen per payer (GIFT_SETTLEMENT=auto|ledger|aindrive). The
 * 402's `extra.settlement` names the provider the payer must use, and the
 * resource settles a payment with the provider it named — a signature made
 * one way is never settled the other way.
 */

export type SettlementId = "family-ledger" | "aindrive";

export interface PayerRef {
  userId: string;
  name: string;
}

export type SettleResult =
  | { ok: true; receipt: string; transaction?: string; network?: string }
  | { ok: false; error: string };

export interface X402Provider {
  id: SettlementId;
  /** This provider can act for `userId` right now (wallet reachable). */
  ready(userId: string): Promise<boolean>;
  /** The wallet money for `userId` lands in — the gift's `payTo`. */
  payToOf(userId: string): Promise<Hex>;
  /** The payer's side: an EIP-3009 authorization for `req`, signed by their wallet. */
  sign(payer: PayerRef, req: PaymentRequirements, resourceUrl: string): Promise<PaymentPayload>;
  /** Who signed `payment`, as a person here — null when the wallet is nobody's. */
  payerOf(payment: PaymentPayload): Promise<PayerRef | null>;
  /** The resource's side: move the money. `verified` has already passed lib/gift.verifyPayment. */
  settle(spec: GiftSpec, payment: PaymentPayload, payer: PayerRef): Promise<SettleResult>;
}

export type SettlementMode = "auto" | "ledger" | "aindrive";

export function settlementMode(): SettlementMode {
  const v = (process.env.GIFT_SETTLEMENT ?? "auto").trim().toLowerCase();
  return v === "ledger" || v === "aindrive" ? v : "auto";
}
