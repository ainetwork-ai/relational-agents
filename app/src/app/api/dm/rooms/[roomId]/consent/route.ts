import { NextRequest, NextResponse } from "next/server";
import { verifyTypedData } from "viem";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { chatMessages, chatRooms, chatRoomMembers, relationContracts, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { publishToRoomMembers, requireRoomAccess } from "@/lib/chat-room-access";
import { buildRelationConsentTypedData } from "@/lib/relation-contract";
import { provisionRoomAgent } from "@/lib/agent/provision";
import { relayRelationOnChain } from "@/lib/relation-registry";

export const dynamic = "force-dynamic";

const HEX_ADDR = /^0x[0-9a-f]{40}$/i;

/** Human members + wallet addresses — the contract's parties. */
async function contractParties(roomId: string) {
  const members = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.roomId, roomId));
  const ids = members.map((m) => m.userId);
  return ids.length
    ? await db
        .select({ id: users.id, address: users.ainAddress, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
}

function typedDataFor(roomId: string, parties: { address: string }[]) {
  const addrs = parties.map((p) => p.address);
  if (addrs.length < 2 || !addrs.every((a) => HEX_ADDR.test(a))) return null;
  return buildRelationConsentTypedData(roomId, addrs);
}

/** GET → contract status + the EIP-712 payload the caller's wallet signs. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const parties = await contractParties(roomId);
  const signedRows = await db
    .select({ userId: relationContracts.userId })
    .from(relationContracts)
    .where(eq(relationContracts.roomId, roomId));
  const signed = new Set(signedRows.map((r) => r.userId));
  const typedData = typedDataFor(roomId, parties);

  return NextResponse.json({
    consentAt: access.room.consentAt,
    required: parties.length,
    parties: parties.map((p) => ({
      userId: p.id,
      displayName: p.displayName,
      signed: signed.has(p.id),
    })),
    mySigned: signed.has(auth.user.id),
    canSign: typedData !== null && HEX_ADDR.test(auth.user.ainAddress),
    typedData,
  });
}

/** POST { signature } → verifies the caller's EIP-712 consent signature and
 * records it; when both parties have signed, stamps consentAt — the agent is
 * born. The stored pair can be relayed on-chain to
 * RelationalAgentRegistry.registerRelationalAgent() as-is. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const address = auth.user.ainAddress;
  if (!HEX_ADDR.test(address))
    return NextResponse.json(
      { error: "A wallet account is required to sign the contract" },
      { status: 400 }
    );

  const body = await req.json().catch(() => ({}));
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!/^0x[0-9a-f]+$/i.test(signature))
    return NextResponse.json({ error: "signature required" }, { status: 400 });

  const parties = await contractParties(roomId);
  const typedData = typedDataFor(roomId, parties);
  if (!typedData)
    return NextResponse.json(
      { error: "Every member needs a wallet account to sign the contract" },
      { status: 400 }
    );

  const valid = await verifyTypedData({
    ...typedData,
    address: address.toLowerCase() as `0x${string}`,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  await db
    .insert(relationContracts)
    .values({
      roomId,
      userId: auth.user.id,
      address: address.toLowerCase(),
      message: JSON.stringify(typedData),
      signature,
    })
    .onConflictDoNothing();

  const signedRows = await db
    .select({ userId: relationContracts.userId })
    .from(relationContracts)
    .where(eq(relationContracts.roomId, roomId));
  const signed = new Set(signedRows.map((r) => r.userId));
  const complete = parties.length >= 2 && parties.every((p) => signed.has(p.id));

  let consentAt = access.room.consentAt;
  if (complete && !consentAt) {
    consentAt = new Date();
    await db.update(chatRooms).set({ consentAt }).where(eq(chatRooms.id, roomId));
 // The agent is born the moment consent completes — no extra button. Provision
 // it and greet the room so both people see it come alive.
    try {
      const room = { ...access.room, consentAt };
      const memberIds = parties.map((p) => p.id);
      const { agentUserId, alreadyExisted } = await provisionRoomAgent(
        room,
        memberIds,
        auth.user.id
      );
      if (!alreadyExisted) {
        await db.insert(chatMessages).values({
          roomId,
          authorId: agentUserId,
          text: `Hi ${parties.map((p) => p.displayName).join(" & ")} 💞 I'm your relationship agent, born from both your signatures. I'll remember only what the two of you share here — nothing leaves this relationship. Nice to meet you both!`,
        });
      }
 // Relay both signatures on-chain: mint the agent in the ERC-8004 registry.
      const contracts = await db
        .select({ address: relationContracts.address, signature: relationContracts.signature })
        .from(relationContracts)
        .where(eq(relationContracts.roomId, roomId));
      const signaturesByAddress = Object.fromEntries(
        contracts.map((c) => [c.address.toLowerCase(), c.signature])
      );
      const onchain = await relayRelationOnChain({
        roomId,
        signaturesByAddress,
        agentUri: `okf://relationship/${roomId}`,
      });
      if (onchain) {
 // stash the tx + agentId on the agent's card so the UI can link it
        const agentRow = await db.select().from(users).where(eq(users.id, agentUserId)).limit(1);
        const card = (agentRow[0]?.agentCardJson ?? {}) as Record<string, unknown>;
        await db
          .update(users)
          .set({ agentCardJson: { ...card, onchain } })
          .where(eq(users.id, agentUserId));
        if (onchain.txHash) {
          await db.insert(chatMessages).values({
            roomId,
            authorId: agentUserId,
            text: `📜 Registered on-chain — agent #${onchain.agentId} in the ERC-8004 registry (Sepolia). tx: ${onchain.txHash}`,
          });
        }
      }
    } catch (err) {
      console.error("agent auto-provision failed:", err);
    }
  }
  await publishToRoomMembers(
    roomId,
    { type: "dm-message", clientId: req.headers.get("x-client-id") },
    parties.map((p) => p.id)
  );

  return NextResponse.json({ signed: signed.size, required: parties.length, consentAt });
}
