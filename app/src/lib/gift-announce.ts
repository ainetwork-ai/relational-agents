import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessages, chatRoomBots, chatRoomMembers, chatRooms, users } from "@/lib/db/schema";
import { publishToRoomMembers } from "@/lib/chat-room-access";
import type { GiftSpec } from "@/lib/gift";

/** Tells the family: in every room of the workspace where both the payer and
 *  the maker are, the room's agent says the gift was opened with pocket money. */
export async function announceGift(workspaceId: string, payerId: string, spec: GiftSpec, receipt: string): Promise<void> {
  const [payer] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, payerId));
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
      text: `🎁 ${payer?.name ?? ""}께서 ${spec.recipientName}에게 용돈 ${spec.amountKrw.toLocaleString("ko-KR")}원을 보내고 「${spec.title}」을 여셨어요. (x402 결제 · 영수증 ${receipt})`,
    });
    await publishToRoomMembers(r.id, { type: "dm-message", clientId: `agent:${bot.agent}` });
  }
}
