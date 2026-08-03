import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEFAULT_PROFILE } from "./profiles";
import {
  agentAccessTokens,
  chatRoomBots,
  chatRoomMembers,
  users,
  type AgentConfig,
  type ChatRoom,
} from "@/lib/db/schema";

/** Externally visible A2A base — deployment address set via env (spec v2 §3). */
export function a2aBaseUrl(): string {
  return (process.env.A2A_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function agentA2aUrl(agentUserId: string): string {
  return `${a2aBaseUrl()}/api/a2a/${agentUserId}`;
}

/**
 * What a new agent is born with: a profile and nothing else.
 *
 * persona and behavior used to be seeded here too, and that quietly made the
 * profile system decorative — resolveProfile treats a stored value as a room
 * override, so every agent in the database carried "Relationship agent" /
 * "warm" and no profile could ever change its own voice. Absent means "follow
 * the profile", which is what a fresh agent should do.
 */
const DEFAULT_CONFIG: AgentConfig = {
  profile: DEFAULT_PROFILE.key,
  skills: ["relationship-doc"],
};

// Agents used to be given an AIN keypair here, stored as plain hex in
// encryptedPrivateKey, so they could sign on-chain. Nothing signs any more —
// the wallet layer is gone — so no key is generated and the column is dropped.

export interface ProvisionResult {
  agentUserId: string;
  memberTokens: Record<string, string>; // userId → Bearer token
  alreadyExisted: boolean;
}

/**
 * Provisions the relationship agent once consent completes (spec v2 §7-2).
 * Idempotent: an existing relationship-agent bot in the room is returned as-is.
 * - creates an isAgent user (own AIN key, a2aUrl, default config, ownerId=creator)
 * - chat_room_bots (import) + chat_room_members (membership — the basis for MCP/DM API access)
 * - mints per-member Bearer tokens for external imports
 */
export async function provisionRoomAgent(
  room: ChatRoom,
  memberIds: string[],
  importedBy: string
): Promise<ProvisionResult> {
 // idempotency check: is "our" agent (ownerId = room creator) already imported here
  const bots = await db.select().from(chatRoomBots).where(eq(chatRoomBots.roomId, room.id));
  for (const b of bots) {
    const [u] = await db.select().from(users).where(eq(users.id, b.agentUserId));
    if (u?.isAgent && u.ownerId === room.createdBy) {
      const tokens = await db
        .select()
        .from(agentAccessTokens)
        .where(eq(agentAccessTokens.agentUserId, u.id));
      return {
        agentUserId: u.id,
        memberTokens: Object.fromEntries(tokens.map((t) => [t.userId, t.token])),
        alreadyExisted: true,
      };
    }
  }

  const [agent] = await db
    .insert(users)
    .values({
      displayName: `${room.name} agent`,
      isAgent: true,
      ownerId: room.createdBy,
      agentInvitedBy: importedBy,
      agentConfig: DEFAULT_CONFIG as Record<string, unknown>,
      status: "online",
    })
    .returning();

 // a2aUrl is filled once the id exists; the card JSON is stored too
  const a2aUrl = agentA2aUrl(agent.id);
  await db
    .update(users)
    .set({ a2aUrl, a2aId: `relationship-agent:${agent.id}`, agentCardJson: buildAgentCard(agent.id, room.name) })
    .where(eq(users.id, agent.id));

  await db.insert(chatRoomBots).values({ roomId: room.id, agentUserId: agent.id, importedBy });
  await db
    .insert(chatRoomMembers)
    .values({ roomId: room.id, userId: agent.id })
    .onConflictDoNothing();

  const memberTokens: Record<string, string> = {};
  for (const userId of memberIds) {
    const token = `rat_${randomUUID().replaceAll("-", "")}`;
    await db.insert(agentAccessTokens).values({ token, agentUserId: agent.id, userId });
    memberTokens[userId] = token;
  }

  return { agentUserId: agent.id, memberTokens, alreadyExisted: false };
}

/** A2A agent card (spec: /.well-known/agent-card.json shape, Direct Configuration deployment). */
export function buildAgentCard(agentUserId: string, roomName: string) {
  const url = agentA2aUrl(agentUserId);
  return {
    protocolVersion: "0.3.0",
    name: `${roomName} relationship agent`,
    description:
      "An agent that watches this relationship's conversation, maintains the relationship document (SSOT), and answers questions with sources.",
    url,
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false, pushNotifications: false },
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", description: "Per-member room token" },
    },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "relationship-memory",
        name: "Relationship memory / Q&A",
        description: "Answers questions from the relationship document and folds new facts back into it",
        tags: ["relationship", "memory"],
      },
    ],
  };
}
