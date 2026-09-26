import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, chatRoomMembers, chatRooms, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import type { GiftSpec } from "@/lib/gift";
import { getT } from "@/i18n/server";
import { giftPrice } from "@/lib/gift-price";

/** Tells the family: in every room of the workspace where both the payer and
 *  the maker are, the room's agent says the gift was opened with pocket money.
 *  Called from request handlers only; the text is in the payer's saved
 *  language, else the request's (cookie → DEFAULT_LOCALE → browser → ko). */
export async function announceGift(workspaceId: string, payerId: string, spec: GiftSpec, receipt: string): Promise<void> {
  const [payer] = await db.select({ name: users.displayName, language: users.language }).from(users).where(eq(users.id, payerId));
  const t = await getT(payer?.language);
  const rooms = await db.select({ id: chatRooms.id }).from(chatRooms).where(eq(chatRooms.workspaceId, workspaceId));
  for (const r of rooms) {
    const members = (
      await db.select({ u: chatRoomMembers.userId }).from(chatRoomMembers).where(eq(chatRoomMembers.roomId, r.id))
    ).map((m) => m.u);
    if (!members.includes(payerId) || !members.includes(spec.recipientUserId)) continue;
    const [bot] = await db
      .select({ agent: chatRoomBots.agentUserId })
      .from(chatRoomBots)
      .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
      .where(and(eq(chatRoomBots.roomId, r.id), inArray(users.isAgent, [true])))
      .limit(1);
    if (!bot) continue;
    await db.insert(chatMessages).values({
      roomId: r.id,
      authorId: bot.agent,
      text: t("🎁 {payer} sent {recipient} {amount} in pocket money and opened “{title}”. (x402 payment · receipt {receipt})", {
        payer: payer?.name ?? "",
        recipient: spec.recipientName,
        amount: giftPrice(spec, (n) => t("₩{n}", { n: n.toLocaleString("ko-KR") })),
        title: spec.title,
        receipt,
      }),
    });
    await publishToRoomMembers(r.id, { type: "dm-message", clientId: `agent:${bot.agent}` });
  }
}
