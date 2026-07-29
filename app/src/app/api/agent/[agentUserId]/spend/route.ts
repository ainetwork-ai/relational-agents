import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
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
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, chatRoomMembers, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { agentKitFor, invokeAction, txHashFromActionResult } from "@/lib/agent/agentkit";
import { EGG_TART_PRICE_ETH, sellerPayTo } from "@/lib/seller";

export const dynamic = "force-dynamic";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
/** Enough Sepolia ETH for the price plus gas — dev convenience, see below. */
const TOPUP_ETH = "0.002";

/**
 * The agent spends.
 *
 * A member asks their relationship agent to buy from Tarts&Co. The agent pays
 * with its OWN wallet through AgentKit's `native_transfer` action, then
 * presents the payment to the seller, which decides whether two humans stand
 * behind it. Either answer — the tarts or the refusal — is posted back into
 * the room by the agent, because the room is where the relationship can see
 * what its agent did with its money.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ agentUserId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentUserId } = await ctx.params;

  const [agent] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, agentUserId), eq(users.isAgent, true)))
    .limit(1);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const [bot] = await db
    .select({ roomId: chatRoomBots.roomId })
    .from(chatRoomBots)
    .where(eq(chatRoomBots.agentUserId, agentUserId))
    .limit(1);
  if (!bot) return NextResponse.json({ error: "Agent has no room" }, { status: 404 });

 // only the people whose relationship this agent IS may spend its money
  const [membership] = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, bot.roomId), eq(chatRoomMembers.userId, auth.user.id)))
    .limit(1);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!agent.encryptedPrivateKey)
    return NextResponse.json({ error: "Agent has no wallet key" }, { status: 500 });

  const roomId = bot.roomId;
  const post = async (text: string) => {
    await db.insert(chatMessages).values({ roomId, authorId: agentUserId, text });
  };

  try {
    const { agentkit, address } = await agentKitFor(agent.encryptedPrivateKey);
    const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

 // Agents are born without gas money. In production the relationship funds
 // its agent; for the demo the deployer tops it up on first spend.
    let balance = await pub.getBalance({ address });
    let fundingTx: string | null = null;
    if (balance < parseEther(EGG_TART_PRICE_ETH)) {
      const funderKey = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
      if (!funderKey || !/^0x[0-9a-fA-F]{64}$/.test(funderKey))
        return NextResponse.json({ error: "Agent wallet is empty and no funder is configured" }, { status: 503 });
      const funder = createWalletClient({
        account: privateKeyToAccount(funderKey as Hex),
        chain: sepolia,
        transport: http(RPC),
      });
      fundingTx = await funder.sendTransaction({ to: address, value: parseEther(TOPUP_ETH) });
      await pub.waitForTransactionReceipt({ hash: fundingTx as Hex, timeout: 180_000 });
      balance = await pub.getBalance({ address });
    }

 // the spend itself — an AgentKit action, not a raw viem call
    const actionResult = await invokeAction(agentkit, "native_transfer", {
      to: sellerPayTo(),
      value: EGG_TART_PRICE_ETH,
    });
    const paymentTx = txHashFromActionResult(actionResult);
    if (!paymentTx) {
      await post(`🥮 I tried to buy us egg tarts and the payment failed — ${actionResult}`);
      await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });
      return NextResponse.json({ error: "payment failed", detail: actionResult }, { status: 502 });
    }

 // present the payment to the seller, which asks the chain about our humans
    const base = req.nextUrl.origin;
    const sellerRes = await fetch(`${base}/api/seller/egg-tarts`, {
      headers: { "x-payment-tx": paymentTx },
      cache: "no-store",
    });
    const sellerBody = (await sellerRes.json().catch(() => ({}))) as Record<string, unknown>;

    if (sellerRes.ok) {
      await post(
        `🥮 Bought us 2 egg tarts from Tarts&Co — they only sell to agents with two verified humans behind them, and the chain vouched for us. Paid ${EGG_TART_PRICE_ETH} ETH from my own wallet. payment tx: ${paymentTx}`
      );
    } else {
      await post(
        `🚫 Tarts&Co turned me away (${sellerRes.status} — ${String(sellerBody.error ?? "rejected")}). I paid ${EGG_TART_PRICE_ETH} ETH but could not prove two real people stand behind me. payment tx: ${paymentTx}`
      );
    }
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: null });

    return NextResponse.json(
      {
        agentWallet: address,
        balance: formatEther(balance),
        fundingTx,
        agentkitAction: actionResult,
        paymentTx,
        seller: { status: sellerRes.status, body: sellerBody },
      },
      { status: sellerRes.ok ? 200 : 402 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("agent spend failed:", err);
    return NextResponse.json({ error: "spend failed", detail }, { status: 500 });
  }
}
