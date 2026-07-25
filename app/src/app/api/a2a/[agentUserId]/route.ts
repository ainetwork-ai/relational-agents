import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentAccessTokens, chatMessages, chatRoomBots, chatRooms, users } from "@/lib/db/schema";
import { UUID_RE } from "@/lib/chat-room-access";
import { buildAgentCard } from "@/lib/agent/provision";
import { respondToMessage } from "@/lib/agent/respond";

export const dynamic = "force-dynamic";

/**
 * In-app A2A agent runtime (spec v2 §3, §7-3).
 * GET  → the agent card (Direct Configuration deployment — card URL imported directly)
 * POST → JSON-RPC SendMessage (+ the legacy "message/send" alias)
 * Auth: Bearer member token (external platforms, speaker identity) or A2A_SERVICE_TOKEN.
 * A third party who only knows the URL gets 401 — spec v2 §6.
 */

async function loadAgent(agentUserId: string) {
  if (!UUID_RE.test(agentUserId)) return null;
  const [agent] = await db.select().from(users).where(eq(users.id, agentUserId));
  return agent?.isAgent ? agent : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ agentUserId: string }> }) {
  const { agentUserId } = await ctx.params;
  const agent = await loadAgent(agentUserId);
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });
  // the card is public (just name/endpoint/auth scheme — standard spec practice)
  const card =
    (agent.agentCardJson as Record<string, unknown>) ?? buildAgentCard(agent.id, agent.displayName);
  return NextResponse.json(card);
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ agentUserId: string }> }) {
  const { agentUserId } = await ctx.params;
  const agent = await loadAgent(agentUserId);
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const id = (body as { id?: unknown })?.id;
  if (!body || typeof body !== "object")
    return rpcError(id, -32700, "Parse error", 400);
  const method = (body as { method?: string }).method;
  if (method !== "SendMessage" && method !== "message/send")
    return rpcError(id, -32601, `Method not found: ${method}`);

  // --- auth: Bearer member token → speaker identity. Missing/mismatched → 401 (blocks third parties) ---
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let callerUserId: string | null = null;
  if (bearer && process.env.A2A_SERVICE_TOKEN && bearer === process.env.A2A_SERVICE_TOKEN) {
    callerUserId = null; // internal service call — trust metadata's authorId
  } else if (bearer) {
    const [tok] = await db
      .select()
      .from(agentAccessTokens)
      .where(and(eq(agentAccessTokens.token, bearer), eq(agentAccessTokens.agentUserId, agent.id)));
    if (!tok) return rpcError(id, -32001, "Unauthorized", 401);
    callerUserId = tok.userId;
  } else {
    return rpcError(id, -32001, "Unauthorized", 401);
  }

  const params = (body as { params?: { message?: { parts?: { kind?: string; text?: string }[]; metadata?: Record<string, unknown>; messageId?: string } } }).params;
  const text = (params?.message?.parts ?? [])
    .filter((p) => p?.kind === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text) return rpcError(id, -32602, "No text part");

  // room resolution: metadata.roomId (verified to be a room this agent is imported into) → else its only room
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.agentUserId, agent.id));
  const metaRoomId = params?.message?.metadata?.roomId;
  let roomId: string | null = null;
  if (typeof metaRoomId === "string" && bots.some((b) => b.roomId === metaRoomId)) {
    roomId = metaRoomId;
  } else if (bots.length === 1) {
    roomId = bots[0].roomId;
  }
  if (!roomId) return rpcError(id, -32602, "Unknown room for this agent");
  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room) return rpcError(id, -32602, "Room not found");

  // utterances arriving via external platforms land in the room log too
  // (cross-platform shared memory). Speaker = token owner (internal service
  // calls use metadata.authorId).
  const authorId =
    callerUserId ??
    (typeof params?.message?.metadata?.authorId === "string"
      ? (params.message.metadata.authorId as string)
      : null);
  if (!authorId) return rpcError(id, -32602, "Unknown author");

  let message = null as typeof chatMessages.$inferSelect | null;
  if (params?.message?.messageId && UUID_RE.test(params.message.messageId)) {
    // redelivery of a message the dispatcher already stored (never happens
    // in-app, but external eve may echo it back) — prevents duplicate rows
    const [existing] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, params.message.messageId));
    message = existing ?? null;
  }
  if (!message) {
    const [inserted] = await db
      .insert(chatMessages)
      .values({ roomId, authorId, text })
      .returning();
    message = inserted;
  }

  const result = await respondToMessage(agent.id, roomId, message);
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    result: {
      kind: "message",
      role: "agent",
      messageId: result.messageId ?? null,
      parts: result.action === "reply" && result.text ? [{ kind: "text", text: result.text }] : [],
      metadata: { action: result.action, roomId },
    },
  });
}
