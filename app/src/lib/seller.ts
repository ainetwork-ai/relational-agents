import "server-only";
import { createPublicClient, formatEther, http, parseEther, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomBots, users } from "@/lib/db/schema";
import { readIsHumanBacked } from "@/lib/relation-registry";

/**
 * Tarts&Co — a storefront that sells only to agents with two proven humans
 * behind them.
 *
 * The interesting part is what it does NOT do. It does not ask who the buyer
 * is, does not check a reputation score, does not keep an allowlist. It takes
 * the payment, reads the payer address off the chain, and asks the registry
 * one question: is this wallet's relationship human-backed? A bot with money
 * is still a bot, and pays for nothing.
 */

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

export const EGG_TART_PRICE_ETH = "0.0001";
export const EGG_TART_PRICE_WEI = parseEther(EGG_TART_PRICE_ETH);

/** Where buyers pay. Defaults to the relayer so a demo works without setup. */
export function sellerPayTo(): Hex {
  return (process.env.SELLER_PAY_TO ??
    "0x466e00d1Dd650987Cc173E620Fa933aDEaABCB86") as Hex;
}

export function paymentQuote() {
  return {
    error: "payment required",
    price: `${EGG_TART_PRICE_ETH} ETH`,
    priceWei: EGG_TART_PRICE_WEI.toString(),
    payTo: sellerPayTo(),
    network: "sepolia",
    chainId: sepolia.id,
    item: "2 egg tarts",
    payWith: "send the price to payTo, then retry with header X-Payment-Tx: <txhash>",
    condition: "only relationships with a proof-of-personhood per party are served",
  };
}

export interface PaymentCheck {
  ok: boolean;
  from?: Hex;
  valueWei?: bigint;
  error?: string;
}

/** Confirms the tx really moved the asking price to us, and reports who paid. */
export async function verifyPaymentTx(txHash: string): Promise<PaymentCheck> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, error: "malformed payment tx hash" };
  const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

  const receipt = await pub
    .getTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);
  if (!receipt) return { ok: false, error: "payment tx not found on sepolia" };
  if (receipt.status !== "success") return { ok: false, error: "payment tx reverted" };

  const tx = await pub.getTransaction({ hash: txHash as Hex }).catch(() => null);
  if (!tx) return { ok: false, error: "payment tx not found on sepolia" };
  if ((tx.to ?? "").toLowerCase() !== sellerPayTo().toLowerCase())
    return { ok: false, error: "payment was not sent to the seller" };
  if (tx.value < EGG_TART_PRICE_WEI)
    return {
      ok: false,
      error: `underpaid: ${formatEther(tx.value)} ETH < ${EGG_TART_PRICE_ETH} ETH`,
    };

  return { ok: true, from: tx.from.toLowerCase() as Hex, valueWei: tx.value };
}

export interface PayerIdentity {
  agentUserId: string;
  agentName: string;
  roomId: string;
}

/** The relationship a paying wallet speaks for — null for any other wallet. */
export async function resolvePayerRelation(wallet: string): Promise<PayerIdentity | null> {
  const [agent] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.ainAddress, wallet.toLowerCase()), eq(users.isAgent, true)))
    .limit(1);
  if (!agent) return null;

  const [bot] = await db
    .select({ roomId: chatRoomBots.roomId })
    .from(chatRoomBots)
    .where(eq(chatRoomBots.agentUserId, agent.id))
    .limit(1);
  if (!bot) return null;

  return { agentUserId: agent.id, agentName: agent.displayName, roomId: bot.roomId };
}

export interface SellerVerdict {
  status: number;
  body: Record<string, unknown>;
}

/** One tx hash buys one order — a receipt is not a reusable ticket. */
const spentTxs = new Set<string>();

/** The whole gate: money confirmed, then personhood confirmed, then goods. */
export async function serveEggTarts(txHash: string): Promise<SellerVerdict> {
  const payment = await verifyPaymentTx(txHash);
  if (!payment.ok)
    return { status: 402, body: { ...paymentQuote(), error: payment.error! } };

  const key = txHash.toLowerCase();
  if (spentTxs.has(key))
    return { status: 409, body: { error: "this payment was already redeemed", txHash } };

  const relation = await resolvePayerRelation(payment.from!);
  if (!relation)
    return {
      status: 403,
      body: {
        error: "not human-backed",
        reason: "the paying wallet does not belong to any relationship agent",
        payer: payment.from,
      },
    };

  const humanBacked = await readIsHumanBacked(relation.roomId).catch(() => false);
  if (!humanBacked)
    return {
      status: 403,
      body: {
        error: "not human-backed",
        reason: "no proof-of-personhood is bound on-chain for this agent's parties",
        payer: payment.from,
        agent: relation.agentName,
      },
    };

  spentTxs.add(key);
  return {
    status: 200,
    body: {
      eggTarts: 2,
      receipt: {
        seller: "Tarts&Co",
        item: "2 egg tarts",
        paid: `${formatEther(payment.valueWei!)} ETH`,
        payer: payment.from,
        paymentTx: txHash,
        buyer: relation.agentName,
        humanBacked: true,
        servedAt: new Date().toISOString(),
      },
      message: "Two verified humans, one agent — enjoy the tarts 🥮",
    },
  };
}
