import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
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

const DEFAULT_CONFIG: AgentConfig = {
  persona: { name: "Relationship agent", tone: "warm" },
  skills: ["relationship-doc"],
  behavior: { proactive: true },
};

/** Generate the agent's own AIN key → derive its address. The key sits in
 * encryptedPrivateKey (demo: plain hex — production would KMS-encrypt). */
async function generateAgentKey(): Promise<{ address: string; privateKey: string }> {
  const privateKey = randomBytes(32).toString("hex");
  const Ain = (await import("@ainblockchain/ain-js")).default;
  const ain = new Ain("https://devnet-api.ainetwork.ai", null, 0);
  const address = ain.wallet.add(privateKey).toLowerCase();
  return { address, privateKey };
}

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

  const { address, privateKey } = await generateAgentKey();
  const [agent] = await db
    .insert(users)
    .values({
      ainAddress: address,
      displayName: `${room.name} agent`,
      isAgent: true,
      ownerId: room.createdBy,
      agentInvitedBy: importedBy,
      encryptedPrivateKey: privateKey,
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
