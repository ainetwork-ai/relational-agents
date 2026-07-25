import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRoomMembers } from "@/lib/db/schema";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";
import { maybeAutoRun } from "@/lib/agent/triggers";
import { dispatchToRoomBots } from "@/lib/agent/dispatch";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8_000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_NAME = 200;

interface Attachment {
  url: string;
  name: string;
}

/** 업로드 API가 돌려준 같은 오리진 /uploads/* 경로만 허용 (외부/스킴 주입 차단). */
function parseAttachments(raw: unknown): Attachment[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  const out: Attachment[] = [];
  for (const item of raw) {
    const url = (item as { url?: unknown })?.url;
    const name = (item as { name?: unknown })?.name;
    if (typeof url !== "string" || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return null;
    out.push({
      url,
      name: typeof name === "string" ? name.slice(0, MAX_ATTACHMENT_NAME) : "file",
    });
  }
  return out;
}

/** GET /api/dm/rooms/{roomId}/messages → { messages } (오름차순) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return NextResponse.json({ messages });
}

/** POST { text?, attachments?: [{url,name}] } → { message, autoRun? }.
 *  전송 = 읽음 처리, 멤버 인박스로 dm-message 알림(본문 미포함) 발행. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

  const body = await req.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const attachments = parseAttachments(body?.attachments);
  if (attachments === null)
    return NextResponse.json({ error: "Bad attachments" }, { status: 400 });
  if (!text && attachments.length === 0)
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (text.length > MAX_TEXT)
    return NextResponse.json({ error: `Text too long (max ${MAX_TEXT})` }, { status: 400 });

  // authorId는 항상 세션 사용자 — 클라이언트 지정 금지(위조 방지)
  const [message] = await db
    .insert(chatMessages)
    .values({ roomId, authorId: auth.user.id, text, attachments })
    .returning();

  // 보낸 사람은 자기 메시지를 읽은 것 — 미읽음 계산 기준선 갱신
  await db
    .update(chatRoomMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatRoomMembers.roomId, roomId), eq(chatRoomMembers.userId, auth.user.id)));

  await publishToRoomMembers(roomId, {
    type: "dm-message",
    clientId: req.headers.get("x-client-id"),
  });

  // dm 방도 agent 방과 같은 수확 트리거를 공유 — K건 누적 즉시 / 유휴 예약
  const autoRun = await maybeAutoRun(room);

  // 방에 임포트된 봇들에게 A2A 배달 (스펙 v2 §5) — 응답을 막지 않는 fire-and-forget
  void dispatchToRoomBots(room, message).catch((err) =>
    console.error("bot dispatch failed:", err)
  );
  return NextResponse.json({ message, autoRun }, { status: 201 });
}
