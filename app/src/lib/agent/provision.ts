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

/** 외부 노출용 A2A 베이스 — env로 배포 주소 지정 (스펙 v2 §3). */
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

/** 에이전트 전용 AIN 키 생성 → 주소 유도. 키는 encryptedPrivateKey에 보관
 *  (데모: 평문 hex — 실서비스는 KMS 암호화 자리). */
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
 * 상호 동의 완료 시 관계 에이전트 프로비저닝 (스펙 v2 §7-2).
 * 멱등: 방에 이미 관계 에이전트 봇이 있으면 그대로 반환.
 * - users에 isAgent 사용자 생성 (전용 AIN 키, a2aUrl, 기본 config, ownerId=생성자)
 * - chat_room_bots(임포트) + chat_room_members(멤버 — MCP/DM API 접근 근거)
 * - 방 멤버별 외부 임포트용 Bearer 토큰 발급
 */
export async function provisionRoomAgent(
  room: ChatRoom,
  memberIds: string[],
  importedBy: string
): Promise<ProvisionResult> {
  // 멱등 검사: 이 방에 이미 임포트된 "우리" 에이전트(ownerId=방 생성자)가 있나
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

  // a2aUrl은 id 확정 후 채운다 + 카드 JSON도 저장
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

/** A2A 에이전트 카드 (스펙: /.well-known/agent-card.json 형식, Direct Configuration 배포). */
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
        tags: ["relationship", "memory", "notion"],
      },
    ],
  };
}
