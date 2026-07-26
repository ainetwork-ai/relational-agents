import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { agentRoomStates, chatRooms, users, type AgentConfig } from "@/lib/db/schema";
import { PROFILES, resolveProfile } from "@/lib/agent/profiles";
import { ensureOkfDocTree } from "@/lib/agent/okf-docs";
import { setOkfAcl } from "@/lib/okf-acl";
import { eq } from "drizzle-orm";
import { requireRoomAccess, roomMemberIds, publishToRoomMembers } from "@/lib/chat-room-access";
import { provisionRoomAgent } from "@/lib/agent/provision";

export const dynamic = "force-dynamic";

/**
 * POST /api/dm/rooms/{roomId}/agent — consent complete → create & import the
 * relationship agent. Requires the signed contract (consentAt). Idempotent.
 * → { agentUserId, memberTokens: { [userId]: token }, a2aUrl }
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  const { room } = access;

 // The agent is born only from a signed contract: /consent stamps consentAt
 // once every member's wallet has signed. No signature, no agent.
  if (!room.consentAt) {
    return NextResponse.json(
      { error: "Relational agent contract not signed by all members yet" },
      { status: 403 }
    );
  }

  const memberIds = (await roomMemberIds(roomId)).filter((id) => id !== auth.user.id);
  const result = await provisionRoomAgent(room, [auth.user.id, ...memberIds], auth.user.id);
  const [agent] = await db.select().from(users).where(eq(users.id, result.agentUserId));
  if (!result.alreadyExisted)
    await publishToRoomMembers(roomId, { type: "dm-message", clientId: `agent-join:${result.agentUserId}` });

  return NextResponse.json(
    {
      agentUserId: result.agentUserId,
      a2aUrl: agent?.a2aUrl ?? null,
      memberTokens: result.memberTokens,
      alreadyExisted: result.alreadyExisted,
    },
    { status: result.alreadyExisted ? 200 : 201 }
  );
}

/** GET — this room's agent info (404 if none) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const { chatRoomBots } = await import("@/lib/db/schema");
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, roomId));
  if (!bots.length) return NextResponse.json({ error: "No agent" }, { status: 404 });
  const agents = [];
  for (const b of bots) {
    const [u] = await db.select().from(users).where(eq(users.id, b.agentUserId));
    if (u?.isAgent)
      agents.push({
        agentUserId: u.id,
        displayName: u.displayName,
        a2aUrl: u.a2aUrl,
        agentConfig: u.agentConfig ?? {},
        ownerId: u.ownerId,
      });
  }
  return NextResponse.json({ agents });
}

/**
 * PATCH → adjust this room's agent. Any member, no signature: the contract is
 * what brought the agent into being, not what it is told to pay attention to,
 * and a couple should not need a wallet to change its tone.
 *
 * { name }                     rename (the agent's user displayName)
 * { profile }                  which relationship this is — sections, vocabulary, rules
 * { persona, behavior, systemPrompt }
 *                              overrides on top of that profile. null clears one,
 *                              handing the setting back to the profile.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const touchesConfig = ["profile", "persona", "behavior", "systemPrompt"].some((k) => k in body);
  if (!name && !touchesConfig)
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const { chatRoomBots } = await import("@/lib/db/schema");
 // A room can hold more than one bot — external A2A agents get imported the
 // same way. Settings here mean *this relationship's* agent, so pick the one
 // this room gave birth to (ownerId = the room's creator, as provisionRoomAgent
 // sets it) rather than whichever row came back first. Config is stored on the
 // user row, so writing to the wrong bot changes an agent in someone else's
 // room while this one carries on unchanged.
  const roomBots = await db
    .select({ agentUserId: chatRoomBots.agentUserId, isAgent: users.isAgent, ownerId: users.ownerId })
    .from(chatRoomBots)
    .innerJoin(users, eq(users.id, chatRoomBots.agentUserId))
    .where(eq(chatRoomBots.roomId, roomId));
  const ours = roomBots.filter((b) => b.isAgent);
  const bot = ours.find((b) => b.ownerId === access.room.createdBy) ?? ours[0];
  if (!bot) return NextResponse.json({ error: "No agent" }, { status: 404 });

  if (touchesConfig) {
    const [agentUser] = await db.select().from(users).where(eq(users.id, bot.agentUserId));
    const next = { ...((agentUser?.agentConfig ?? {}) as AgentConfig) };

   // an unknown key would silently fall back to the default at read time —
   // better to refuse it here, while someone is looking
    if ("profile" in body) {
      const key = typeof body.profile === "string" ? body.profile : "";
      if (!PROFILES.some((p) => p.key === key))
        return NextResponse.json({ error: `Unknown profile: ${key}` }, { status: 400 });
      next.profile = key;
    }
    if ("persona" in body) {
      const p = (body.persona ?? {}) as { name?: unknown; tone?: unknown };
      const persona: { name?: string; tone?: string } = {};
      if (typeof p.name === "string" && p.name.trim()) persona.name = p.name.trim().slice(0, 80);
      if (typeof p.tone === "string" && p.tone.trim()) persona.tone = p.tone.trim().slice(0, 40);
      if (Object.keys(persona).length) next.persona = persona;
      else delete next.persona;
    }
    if ("behavior" in body) {
      const b = (body.behavior ?? {}) as Record<string, unknown>;
      const behavior: { proactive?: boolean; whisperOnQuestion?: boolean } = {};
      if (typeof b.proactive === "boolean") behavior.proactive = b.proactive;
      if (typeof b.whisperOnQuestion === "boolean") behavior.whisperOnQuestion = b.whisperOnQuestion;
      if (Object.keys(behavior).length) next.behavior = behavior;
      else delete next.behavior;
    }
    if ("systemPrompt" in body) {
      const t = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
      if (t) next.systemPrompt = t.slice(0, 2_000);
      else delete next.systemPrompt;
    }

    await db
      .update(users)
      .set({ agentConfig: next as Record<string, unknown> })
      .where(eq(users.id, bot.agentUserId));

   // Reshape the document now rather than at the next agent run. The write
   // pipeline returns early when there is nothing new to file, so a room that
   // is quiet after the change would keep the old section names indefinitely —
   // the setting would look like it had not taken.
    if ("profile" in body) {
      const profile = resolveProfile(next);
      const [state] = await db
        .select()
        .from(agentRoomStates)
        .where(eq(agentRoomStates.roomId, roomId));
      const tree = ensureOkfDocTree(roomId, access.room.name, profile, {
        rootPath: state?.rootOkfPath,
        sectionPaths: state?.sectionOkfPaths,
      });
      const memberIds = await roomMemberIds(roomId);
      await setOkfAcl(tree.rootPath, roomId, [...new Set([access.room.createdBy, ...memberIds])]);
      await db
        .insert(agentRoomStates)
        .values({
          roomId,
          rootOkfPath: tree.rootPath,
          sectionOkfPaths: tree.sectionPaths,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: agentRoomStates.roomId,
          set: {
            rootOkfPath: tree.rootPath,
            sectionOkfPaths: tree.sectionPaths,
            updatedAt: new Date(),
          },
        });
    }

    if (!name) {
      const [agent] = await db.select().from(users).where(eq(users.id, bot.agentUserId));
      await publishToRoomMembers(
        roomId,
        { type: "dm-room", clientId: req.headers.get("x-client-id") },
        await roomMemberIds(roomId)
      );
      return NextResponse.json({
        agentUserId: agent.id,
        displayName: agent.displayName,
        agentConfig: agent.agentConfig ?? {},
      });
    }
  }

  const [agent] = await db
    .update(users)
    .set({ displayName: name })
    .where(eq(users.id, bot.agentUserId))
    .returning();
  await publishToRoomMembers(
    roomId,
    { type: "dm-room", clientId: req.headers.get("x-client-id") },
    await roomMemberIds(roomId)
  );
  return NextResponse.json({ agentUserId: agent.id, displayName: agent.displayName });
}
