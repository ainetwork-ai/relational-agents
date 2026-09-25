import "server-only";
import { eq } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { db } from "@/lib/db";
import { chatMessages, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { agentKitFor, invokeAction, txHashFromActionResult } from "@/lib/agent/agentkit";
import { SONGPYEON_PRICE_ETH, sellerPayTo } from "@/lib/seller";

/**
 * The agent buys from 달빛떡집, and the room learns what happened.
 *
 * Extracted from the spend route so the same act can be asked for two ways —
 * the button in the header, or saying it in the chat — without either becoming
 * the "real" one. Whatever the seller answers, the agent posts it into the
 * room: the relationship is where its agent's spending belongs.
 */

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
/** Enough Sepolia ETH for the price plus gas — dev convenience. */
const TOPUP_ETH = "0.002";

export interface SpendOutcome {
  status: number;
  body: Record<string, unknown>;
}

export async function buySongpyeon(
  agentUserId: string,
  roomId: string,
  origin: string
): Promise<SpendOutcome> {
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId)).limit(1);
  if (!agent?.encryptedPrivateKey)
    return { status: 500, body: { error: "Agent has no wallet key" } };

  const post = async (text: string) => {
    await db.insert(chatMessages).values({ roomId, authorId: agentUserId, text });
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
  };

  try {
    const wallet = await agentKitFor(agent.encryptedPrivateKey);
    const { address, via } = wallet;
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

 // Agents are born without gas money. In production the relationship funds
 // its agent; for the demo the deployer tops it up on first spend.
    let balance = await pub.getBalance({ address });
    let fundingTx: string | null = null;
    if (balance < parseEther(SONGPYEON_PRICE_ETH)) {
      const funderKey = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
      if (!funderKey || !/^0x[0-9a-fA-F]{64}$/.test(funderKey))
        return { status: 503, body: { error: "Agent wallet is empty and no funder is configured" } };
      const funder = createWalletClient({
        account: privateKeyToAccount(funderKey as Hex),
        chain: sepolia,
        transport: http(RPC),
      });
      fundingTx = await funder.sendTransaction({ to: address, value: parseEther(TOPUP_ETH) });
      await pub.waitForTransactionReceipt({ hash: fundingTx as Hex, timeout: 180_000 });
      balance = await pub.getBalance({ address });
    }

    const actionResult = await invokeAction(wallet, "native_transfer", {
      to: sellerPayTo(),
      value: SONGPYEON_PRICE_ETH,
    });
    const paymentTx = txHashFromActionResult(actionResult);
    if (!paymentTx) {
      await post(`🥮 추석 송편을 주문하려 했는데 결제가 실패했어요 — ${actionResult}`);
      return { status: 502, body: { error: "payment failed", detail: actionResult } };
    }

 // present the payment to the seller, which asks the chain about our humans
 // The seller checks the chain, so the payment has to BE on the chain first —
 // asking a block too early reads as "no such payment" and the agent gets
 // turned away for something it actually did.
    await pub.waitForTransactionReceipt({ hash: paymentTx as Hex, timeout: 180_000 });

    const sellerRes = await fetchSeller(origin, paymentTx);
    const sellerBody = (await sellerRes.json().catch(() => ({}))) as Record<string, unknown>;

    await post(
      sellerRes.ok
        ? `🥮 달빛떡집에서 추석 송편 한 상자를 주문했어요 — 실제 사람 두 명이 뒤에 있는 에이전트에게만 파는 곳인데, 체인이 우리 가족을 확인해 줬어요. 제 지갑에서 ${SONGPYEON_PRICE_ETH} ETH를 냈습니다. payment tx: ${paymentTx}`
        : `🚫 달빛떡집이 주문을 거절했어요 (${sellerRes.status} — ${String(sellerBody.error ?? "rejected")}). ${SONGPYEON_PRICE_ETH} ETH를 냈지만 실제 사람 두 명이 뒤에 있다는 걸 증명하지 못했어요. payment tx: ${paymentTx}`
    );

    return {
      status: sellerRes.ok ? 200 : 402,
      body: {
        agentWallet: address,
        balance: formatEther(balance),
        fundingTx,
        paidVia: via,
        agentkitAction: actionResult,
        paymentTx,
        seller: { status: sellerRes.status, body: sellerBody },
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("agent spend failed:", err);
    return { status: 500, body: { error: "spend failed", detail } };
  }
}

/**
 * Ask 달빛떡집, from inside the container.
 *
 * The public origin is HTTPS terminated by nginx out front; reaching for it
 * from in here hits the app's own plain-HTTP port and dies on the TLS
 * handshake. Loopback is the same server without the detour, and the public
 * origin stays as the fallback for deployments where it is not.
 */
async function fetchSeller(origin: string, paymentTx: string): Promise<Response> {
  const headers = { "x-payment-tx": paymentTx };
  const loopback = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  try {
    return await fetch(`${loopback}/api/seller/songpyeon`, { headers, cache: "no-store" });
  } catch {
    return fetch(`${origin}/api/seller/songpyeon`, { headers, cache: "no-store" });
  }
}

/** The one sentence that means "do it", said in the room instead of clicked. */
export function isBuySongpyeonCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  return t === "@agent buy songpyeon" || t === "@agent 송편 주문해" || t === "@agent 송편 주문해줘";
}
