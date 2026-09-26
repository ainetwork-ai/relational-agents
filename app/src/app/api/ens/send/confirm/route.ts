// app/src/app/api/ens/send/confirm/route.ts
// After grandma's wallet sent it: spend the link on its hash, check the USDC Transfer on
// Sepolia, then leave a receipt where she asked and a notification in the recipient's inbox.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, notifications, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { makeT } from "@/i18n/translate";
import { sendSecret } from "@/lib/ens-chain";
import { familyChainFor } from "@/lib/ens-workspace";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { formatUsdc } from "@/lib/ens-family/send-request";
import { recordOfferTx } from "@/lib/agent/send-offer";
import { markConfirmed, markSent, releaseSent, verifySendIntentForConfirm, wasConfirmed, wasSent, type SendIntent } from "@/lib/ens-family/send-token";

export const dynamic = "force-dynamic";

// links whose onchain check is running in this process, so two confirms never announce twice
const g = globalThis as unknown as { __ensConfirming?: Set<string> };
const confirming = (g.__ensConfirming ??= new Set<string>());

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { t?: unknown; txHash?: unknown };
  if (typeof body.t !== "string" || typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash))
    return NextResponse.json({ error: "t and txHash required" }, { status: 422 });

  // an expired link may still be confirmed: the money already moved, this only records it
  const intent = verifySendIntentForConfirm(body.t, sendSecret());
  if (!intent || intent.userId !== auth.user.id) return NextResponse.json({ error: "Not your link" }, { status: 403 });

  // spend the link before waiting on Sepolia: if the check below fails or times out, a reload
  // of /send still shows this hash instead of Send (ask the agent for a new link), never a second payment
  const recorded = wasSent(body.t);
  if (recorded && recorded.toLowerCase() !== body.txHash.toLowerCase())
    return NextResponse.json({ error: "This link already has another transaction" }, { status: 409 });
  if (!recorded) markSent(body.t, body.txHash);
  // the chat's Send card follows the same intent (lib/agent/send-offer.ts; a /send link has none)
  await recordOfferTx(body.t, body.txHash, "sent");
  if (wasConfirmed(body.t)) {
    await recordOfferTx(body.t, body.txHash, "match");
    return NextResponse.json({ ok: true });
  }

  const chain = await familyChainFor(intent.workspaceId);
  if (!chain) return NextResponse.json({ error: "This workspace has no family names yet" }, { status: 422 });
  if (confirming.has(body.t)) return NextResponse.json({ error: "Already confirming" }, { status: 409 });
  confirming.add(body.t);
  try {
    const status = await chain.checkTransfer(body.txHash as `0x${string}`, { from: intent.from, to: intent.to, amountMicro: BigInt(intent.amountMicro) });
    // mined, but reverted or with no USDC leaving her wallet: nothing was paid, so the link may pay again
    if (status === "mismatch") {
      releaseSent(body.t, body.txHash);
      await recordOfferTx(body.t, body.txHash, "mismatch");
      return NextResponse.json({ error: "No USDC left the wallet in that transaction", reason: "mismatch" }, { status: 422 });
    }
    // USDC left her wallet, but not as this link prepared: the link stays spent on this hash
    if (status === "different") {
      await recordOfferTx(body.t, body.txHash, "different");
      return NextResponse.json({ error: "That transaction moved USDC differently", reason: "different" }, { status: 422 });
    }
    // no receipt yet: the money may still move, so the link stays spent on this hash
    if (status === "pending") return NextResponse.json({ error: "Not confirmed on Sepolia yet", reason: "pending" }, { status: 202 });
    await announce(intent, body.txHash);
    markConfirmed(body.t);
    await recordOfferTx(body.t, body.txHash, "match");
  } finally {
    confirming.delete(body.t);
  }
  return NextResponse.json({ ok: true });
}

async function announce(intent: SendIntent, txHash: string) {

  const t = makeT("en");
  const amount = formatUsdc(BigInt(intent.amountMicro));
  const url = `${SEPOLIA_EXPLORER}/tx/${txHash}`;

  // 1) the receipt, in the chat where grandma asked, as that room's agent
  if (intent.roomId) {
    const [bot] = await db
      .select({ agent: chatRoomBots.agentUserId })
      .from(chatRoomBots)
      .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
      .where(and(eq(chatRoomBots.roomId, intent.roomId), eq(users.isAgent, true)))
      .limit(1);
    if (bot) {
      const receiptText = t("💸 Sent {amount} USDC to {name}. {url}", { amount, name: intent.name, url });
      // the in-memory wasSent map forgets on restart, and another valid link with the
      // same from/to/amount could replay an old txHash — the tx url makes the receipt
      // text itself the dedupe key, so a re-confirm never double-posts it
      const [existing] = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(and(eq(chatMessages.roomId, intent.roomId), eq(chatMessages.authorId, bot.agent), eq(chatMessages.text, receiptText)))
        .limit(1);
      if (!existing) {
        await db.insert(chatMessages).values({ roomId: intent.roomId, authorId: bot.agent, text: receiptText });
        await publishToRoomMembers(intent.roomId, { type: "dm-message", clientId: `agent:${bot.agent}` });
      }
    }
  }

  // 2) the recipient's inbox: an ordinary notification, whatever screen they are on
  const [recipient] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.ainAddress}) = ${intent.to.toLowerCase()}`).limit(1);
  if (recipient && recipient.id !== intent.userId) {
    const notifBody = t("{amount} USDC · {url}", { amount, url });
    // same dedupe reasoning as the receipt: the tx url in the body is the key
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, recipient.id), eq(notifications.type, "payment"), eq(notifications.body, notifBody)))
      .limit(1);
    if (!existing)
      await db.insert(notifications).values({
        userId: recipient.id,
        type: "payment",
        actorId: intent.userId,
        body: notifBody,
      });
  }
}
