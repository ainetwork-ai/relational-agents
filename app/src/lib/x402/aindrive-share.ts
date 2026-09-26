import "server-only";
import type { A2uiMessage } from "ain-ui";
import { aindriveHttp, aindriveServer, AindriveError } from "@/lib/aindrive";
import { runAs } from "@/lib/aindrive-account";
import { unb64, type PaymentRequirements } from "@/lib/gift";

/**
 * A gift sold as an aindrive paid share (/s/<token>) — real USDC, settled by
 * aindrive's facilitator on Base. The payer signs the EIP-3009 authorization
 * in their own browser wallet (MetaMask); this server only relays, because
 * aindrive's API has no CORS for another origin:
 *
 *   quote  GET /api/s/<token>                          → 402 PAYMENT-REQUIRED
 *   pay    GET /api/s/<token> + PAYMENT-SIGNATURE      → 200 { txHash }
 *
 * Neither call carries an aindrive session, so aindrive always quotes (no
 * "already a member" shortcut) and credits the purchase to the payer wallet.
 * The unlock trusts only aindrive's own 200 with a txHash — never the browser.
 */

export interface GiftSale {
  /** the paid share's token on aindrive */
  token: string;
  price: number;
  currency: string;
}

function shareUrl(token: string): string {
  const server = aindriveServer();
  if (!server) throw new AindriveError("aindrive is not configured");
  return `${server}/api/s/${encodeURIComponent(token)}`;
}

export type SaleQuote =
  | { ok: true; paymentRequired: string; accepts: PaymentRequirements[]; messages: A2uiMessage[] }
  | { ok: false; status: number; error: string };

export async function quoteSale(sale: GiftSale): Promise<SaleQuote> {
  const r = await fetch(shareUrl(sale.token), { cache: "no-store", headers: { "X-AINUI": "1" }, signal: AbortSignal.timeout(30_000) });
  const header = r.headers.get("PAYMENT-REQUIRED");
  if (r.status !== 402 || !header) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status === 200 ? 409 : 502, error: body.error ?? `aindrive answered ${r.status}` };
  }
  const decoded = unb64<{ accepts?: PaymentRequirements[] }>(header);
  if (!decoded?.accepts?.length) return { ok: false, status: 502, error: "no payment requirements in aindrive's 402" };
  const body = await r.json().catch(() => ({})) as { messages?: A2uiMessage[] };
  if (!Array.isArray(body.messages) || !body.messages.length) return { ok: false, status: 502, error: "aindrive did not return its AIN-UI payment screen. Update aindrive first." };
  return { ok: true, paymentRequired: header, accepts: decoded.accepts, messages: body.messages };
}

export type SalePayment = { ok: true; txHash: string } | { ok: false; status: number; error: string };

/** Hands the browser wallet's PAYMENT-SIGNATURE to aindrive, which settles on chain. */
export async function paySale(sale: GiftSale, paymentSignature: string): Promise<SalePayment> {
  const r = await fetch(shareUrl(sale.token), {
    cache: "no-store",
    headers: { "PAYMENT-SIGNATURE": paymentSignature },
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await r.json().catch(() => ({}))) as { txHash?: string; error?: string };
  if (r.ok && typeof body.txHash === "string" && body.txHash) return { ok: true, txHash: body.txHash };
  const why = body.error ?? (r.headers.get("PAYMENT-REQUIRED") ? unb64<{ error?: string }>(r.headers.get("PAYMENT-REQUIRED")!)?.error : undefined);
  return { ok: false, status: r.ok ? 502 : r.status, error: why ?? `aindrive answered ${r.status}` };
}

/**
 * Puts `path` on `driveId` up for sale as `ownerId`: the folder's payout wallet
 * is set to `payTo`, then an unlisted viewer share at `price` `currency`.
 */
export async function createSale(ownerId: string, input: { driveId: string; path: string; payTo: string; price: number; currency: string }): Promise<GiftSale> {
  const dir = input.path.includes("/") ? input.path.slice(0, input.path.lastIndexOf("/")) : "";
  const drive = `/api/drives/${encodeURIComponent(input.driveId)}`;
  return runAs(ownerId, async () => {
    const payout = await aindriveHttp(`${drive}/payout`, { method: "PUT", body: JSON.stringify({ path: dir, wallet: input.payTo }) });
    if (!payout.ok) throw new AindriveError(`aindrive payout wallet: ${payout.status} ${await payout.text()}`);
    const share = await aindriveHttp(`${drive}/shares`, {
      method: "POST",
      body: JSON.stringify({ path: input.path, role: "viewer", price_usdc: input.price, currency: input.currency, listed: false }),
    });
    const body = (await share.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!share.ok || !body.token) throw new AindriveError(`aindrive share: ${share.status} ${body.error ?? ""}`);
    return { token: body.token, price: input.price, currency: input.currency };
  });
}
