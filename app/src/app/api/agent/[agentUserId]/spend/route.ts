import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRoomBots, chatRoomMembers, users } from "@/lib/db/schema";
import { buySongpyeon } from "@/lib/agent/spend";

export const dynamic = "force-dynamic";

/**
 * The agent spends.
 *
 * A member asks their relationship agent to buy from 달빛떡집. The agent pays
 * with its OWN wallet, then presents the payment to the seller, which decides
 * whether two humans stand behind it. Either answer — the songpyeon or the refusal
 * — is posted back into the room by the agent, because the room is where the
 * relationship can see what its agent did with its money.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ agentUserId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { agentUserId } = await ctx.params;

  const [agent] = await db
    .select({ id: users.id })
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

  const out = await buySongpyeon(agentUserId, bot.roomId, req.nextUrl.origin);
  return NextResponse.json(out.body, { status: out.status });
}
