import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatRoomBots, chatRoomMembers, users } from "@/lib/db/schema";
import { requireRoomAccess } from "@/lib/chat-room-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/dm/rooms/{roomId}/bots { a2aUrl } — 임의 A2A 봇 임포트 (스펙 v2 §7-1).
 * 카드(fetch: a2aUrl 자체 GET → 실패 시 /.well-known/agent-card.json)를 읽어
 * users(isAgent)로 등록하고 방에 임포트한다. 프로바이더 무관 — 우리 관계
 * 에이전트와 동일한 chat_room_bots 경로를 쓴다.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = await req.json().catch(() => ({}));
  const a2aUrl = typeof body?.a2aUrl === "string" ? body.a2aUrl.trim().replace(/\/$/, "") : "";
  if (!/^https?:\/\//.test(a2aUrl))
    return NextResponse.json({ error: "a2aUrl must be http(s)" }, { status: 400 });

  // 카드 발견: ① URL 직접(Direct Configuration) ② 도메인 well-known
  let card: Record<string, unknown> | null = null;
  for (const cardUrl of [
    a2aUrl,
    `${new URL(a2aUrl).origin}/.well-known/agent-card.json`,
  ]) {
    try {
      const res = await fetch(cardUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (typeof data?.name === "string") {
          card = data;
          break;
        }
      }
    } catch {
      // try next
    }
  }
  if (!card) return NextResponse.json({ error: "Agent card not found at URL" }, { status: 422 });

  // 같은 a2aUrl의 봇이 이미 등록돼 있으면 재사용
  let [agent] = await db.select().from(users).where(eq(users.a2aUrl, a2aUrl));
  if (!agent) {
    [agent] = await db
      .insert(users)
      .values({
        ainAddress: `a2a:${a2aUrl}`.slice(0, 120), // 외부 봇 — 지갑 없음, 유니크 식별자
        displayName: String(card.name).slice(0, 80),
        isAgent: true,
        a2aUrl,
        agentCardJson: card,
        agentInvitedBy: auth.user.id,
        ownerId: null,
        status: "online",
      })
      .returning();
  }

  await db
    .insert(chatRoomBots)
    .values({ roomId, agentUserId: agent.id, importedBy: auth.user.id })
    .onConflictDoNothing();
  await db
    .insert(chatRoomMembers)
    .values({ roomId, userId: agent.id })
    .onConflictDoNothing();

  return NextResponse.json(
    { agentUserId: agent.id, displayName: agent.displayName, card },
    { status: 201 }
  );
}
