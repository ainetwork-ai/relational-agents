import { NextRequest, NextResponse } from "next/server";
import { verifyTypedData } from "viem";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import {
  chatMessages,
  chatRooms,
  chatRoomMembers,
  relationContracts,
  relationDissolves,
  users,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { publishToRoomMembers, requireRoomAccess, roomMemberIds } from "@/lib/chat-room-access";
import { buildRelationDissolveTypedData } from "@/lib/relation-contract";
import { relayDissolveOnChain } from "@/lib/relation-registry";

export const dynamic = "force-dynamic";

const HEX_ADDR = /^0x[0-9a-f]{40}$/i;

/** The dissolution's parties are the consent's signers — the same wallets that
 * gave birth to the agent must agree to close it. */
async function dissolveParties(roomId: string) {
  const rows = await db
    .select({ userId: relationContracts.userId, address: relationContracts.address })
    .from(relationContracts)
    .where(eq(relationContracts.roomId, roomId));
  const ids = rows.map((r) => r.userId);
  const nameRows = ids.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const names = new Map(nameRows.map((u) => [u.id, u.displayName]));
  return rows.map((r) => ({
    userId: r.userId,
    address: r.address,
    displayName: names.get(r.userId) ?? "member",
  }));
}

/** GET → dissolution status + the EIP-712 payload the caller's wallet signs. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const parties = await dissolveParties(roomId);
  const signedRows = await db
    .select({ userId: relationDissolves.userId })
    .from(relationDissolves)
    .where(eq(relationDissolves.roomId, roomId));
  const signed = new Set(signedRows.map((r) => r.userId));
  const canDissolve =
    access.room.consentAt !== null &&
    parties.length >= 2 &&
    parties.every((p) => HEX_ADDR.test(p.address));

  return NextResponse.json({
    consentAt: access.room.consentAt,
    dissolvedAt: access.room.dissolvedAt,
    required: parties.length,
    parties: parties.map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      signed: signed.has(p.userId),
    })),
    mySigned: signed.has(auth.user.id),
    canDissolve,
    typedData: canDissolve
      ? buildRelationDissolveTypedData(roomId, parties.map((p) => p.address))
      : null,
  });
}

/** POST { signature } → verifies the caller's EIP-712 RelationDissolve
 * signature and records it. Closing mirrors opening: only when EVERY party has
 * signed is dissolvedAt stamped — the chat closes for everyone, the record and
 * the agent's memories stay sealed, and the signature set is relayed on-chain
 * to dissolveRelationalAgent(). One signature alone never closes anything. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;
  if (!access.room.consentAt)
    return NextResponse.json({ error: "No agent to dissolve — just leave" }, { status: 400 });
  if (access.room.dissolvedAt)
    return NextResponse.json({ error: "Already dissolved" }, { status: 400 });

  const parties = await dissolveParties(roomId);
  const me = parties.find((p) => p.userId === auth.user.id);
  if (!me)
    return NextResponse.json({ error: "Only contract signers can dissolve" }, { status: 403 });
  if (parties.length < 2 || !parties.every((p) => HEX_ADDR.test(p.address)))
    return NextResponse.json({ error: "Contract parties incomplete" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!/^0x[0-9a-f]+$/i.test(signature))
    return NextResponse.json({ error: "signature required" }, { status: 400 });

  const typedData = buildRelationDissolveTypedData(roomId, parties.map((p) => p.address));
  const valid = await verifyTypedData({
    ...typedData,
    address: me.address.toLowerCase() as `0x${string}`,
    signature: signature as `0x${string}`,
  }).catch(() => false);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  await db
    .insert(relationDissolves)
    .values({
      roomId,
      userId: auth.user.id,
      address: me.address.toLowerCase(),
      message: JSON.stringify(typedData),
      signature,
    })
    .onConflictDoNothing();

  const signedRows = await db
    .select({ userId: relationDissolves.userId })
    .from(relationDissolves)
    .where(eq(relationDissolves.roomId, roomId));
  const signed = new Set(signedRows.map((r) => r.userId));
  const complete = parties.every((p) => signed.has(p.userId));

  // capture members before any deletion so everyone gets the closing event
  const memberIds = await roomMemberIds(roomId);

  let dissolvedAt: Date | null = access.room.dissolvedAt;
  if (complete && !dissolvedAt) {
    dissolvedAt = new Date();
    await db.update(chatRooms).set({ dissolvedAt }).where(eq(chatRooms.id, roomId));
    try {
      // the agent's last words — the record outlives the relationship
      const partyIds = parties.map((p) => p.userId);
      const [agent] = await db
        .select({ id: chatRoomMembers.userId })
        .from(chatRoomMembers)
        .where(eq(chatRoomMembers.roomId, roomId))
        .then((rows) => rows.filter((r) => !partyIds.includes(r.id)));
      if (agent) {
        await db.insert(chatMessages).values({
          roomId,
          authorId: agent.id,
          text: `💔 Both of you signed. This relationship is closed — I'll keep everything you shared, sealed, for whoever comes back to read it. Goodbye.`,
        });
      }
      // relay the signature set on-chain: dissolvedAt is stamped, the agent NFT survives
      const sigRows = await db
        .select({ address: relationDissolves.address, signature: relationDissolves.signature })
        .from(relationDissolves)
        .where(eq(relationDissolves.roomId, roomId));
      const onchain = await relayDissolveOnChain({
        roomId,
        signaturesByAddress: Object.fromEntries(
          sigRows.map((r) => [r.address.toLowerCase(), r.signature])
        ),
      });
      if (onchain?.txHash && agent) {
        await db.insert(chatMessages).values({
          roomId,
          authorId: agent.id,
          text: `📜 Dissolved on-chain — agent #${onchain.agentId} remains in the registry, marked dissolved. tx: ${onchain.txHash}`,
        });
      }
    } catch (err) {
      console.error("dissolve finalization failed:", err);
    }
    // the chat closes for everyone — memberships end, the room and its record stay
    await db.delete(chatRoomMembers).where(eq(chatRoomMembers.roomId, roomId));
  }

  await publishToRoomMembers(
    roomId,
    { type: "dm-room", clientId: req.headers.get("x-client-id") },
    memberIds
  );

  return NextResponse.json({
    signed: signed.size,
    required: parties.length,
    dissolvedAt,
  });
}
