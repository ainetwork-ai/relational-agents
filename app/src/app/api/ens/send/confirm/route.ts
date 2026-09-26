// app/src/app/api/ens/send/confirm/route.ts
// After grandma's wallet sent it: check the USDC Transfer on Sepolia, remember the link
// as used, leave a receipt where she asked, and put a notification in the recipient's inbox.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, notifications, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import { makeT } from "@/i18n/translate";
import { familyChain, sendSecret } from "@/lib/ens-chain";
import { SEPOLIA_EXPLORER } from "@/lib/ens-family/config";
import { formatUsdc } from "@/lib/ens-family/send-request";
import { markSent, verifySendIntent, wasSent, type SendIntent } from "@/lib/ens-family/send-token";

export const dynamic = "force-dynamic";

// links whose confirm is running in this process; markSent waits until the writes landed,
// so a failed write is retried by the next confirm instead of being skipped
const g = globalThis as unknown as { __ensConfirming?: Set<string> };
const confirming = (g.__ensConfirming ??= new Set<string>());

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { t?: unknown; txHash?: unknown };
  if (typeof body.t !== "string" || typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash))
    return NextResponse.json({ error: "t and txHash required" }, { status: 422 });

  const intent = verifySendIntent(body.t, sendSecret());
  if (!intent || intent.userId !== auth.user.id) return NextResponse.json({ error: "Not your link" }, { status: 403 });
  if (wasSent(body.t)) return NextResponse.json({ ok: true });

  const chain = familyChain();
  if (!chain) return NextResponse.json({ error: "ENS family not configured" }, { status: 422 });

  const ok = await chain.findTransfer(body.txHash as `0x${string}`, { from: intent.from, to: intent.to, amountMicro: BigInt(intent.amountMicro) }).catch(() => false);
  if (!ok) return NextResponse.json({ error: "No matching USDC transfer in that transaction" }, { status: 422 });
  if (wasSent(body.t)) return NextResponse.json({ ok: true });
  if (confirming.has(body.t)) return NextResponse.json({ error: "Already confirming" }, { status: 409 });
  confirming.add(body.t);
  try {
    await announce(intent, body.txHash);
    markSent(body.t, body.txHash);
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
