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
import { holdsTreasury } from "@/lib/agent/treasury/approvals";
import { SONGPYEON_PRICE_ETH, sellerPayTo } from "@/lib/seller";
import { BUY_SONGPYEON_COMMANDS, SONGPYEON_SHOP } from "@/i18n/content/agent";
import { makeT } from "@/i18n/translate";

/** The spend demo reports into the room in Korean. */
const t = makeT("ko");

/**
 * The agent buys from the rice-cake shop (SONGPYEON_SHOP), and the room learns what happened.
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
  const post = async (text: string) => {
    await db.insert(chatMessages).values({ roomId, authorId: agentUserId, text });
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
  };

 // An agent that holds a relation treasury has one wallet, and it is the
 // relation's: money leaves it only through the treasury's rules and quorum
 // (lib/agent/treasury). This purchase checks neither, so it is refused there
 // before the key is even read — by both entry points, the button and the chat line.
  if (await holdsTreasury(agentUserId)) {
    await post(
      "This agent holds our shared treasury, so its wallet only pays what our Treasury Rules allow — ask me to pay one of our payees instead. Nothing was bought."
    ).catch((err: unknown) => console.error("agent spend: refusal notice failed:", err));
    return { status: 403, body: { error: "This agent's wallet is a relation treasury — it spends only under the treasury's rules" } };
  }

  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId)).limit(1);
  if (!agent?.encryptedPrivateKey)
    return { status: 500, body: { error: "Agent has no wallet key" } };

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
      await post(t("Tried to order Chuseok songpyeon but the payment failed — {result}", { result: String(actionResult) }));
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
        ? t(
            "Ordered a box of Chuseok songpyeon from {shop} — it only sells to agents with two real people behind them, and the chain vouched for our family. I paid {price} ETH from my wallet. payment tx: {tx}",
            { shop: SONGPYEON_SHOP, price: SONGPYEON_PRICE_ETH, tx: paymentTx }
          )
        : t(
            "{shop} turned the order down ({status} — {error}). I paid {price} ETH but couldn't prove there are two real people behind me. payment tx: {tx}",
            { shop: SONGPYEON_SHOP, status: sellerRes.status, error: String(sellerBody.error ?? "rejected"), price: SONGPYEON_PRICE_ETH, tx: paymentTx }
          )
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
 * Ask the rice-cake shop, from inside the container.
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
  return BUY_SONGPYEON_COMMANDS.includes(t);
}
