import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { personhoodProofs } from "@/lib/db/schema";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { relationIdFromRoom } from "@/lib/relation-contract";
import {
  WORLD_ID_ACTION,
  devNullifier,
  verifyCloudProof,
  worldIdConfigured,
  worldIdRpContext,
  type IdKitProof,
} from "@/lib/worldid";

export const dynamic = "force-dynamic";

/** GET → whether the caller has already proved personhood for this room. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const roomId = req.nextUrl.searchParams.get("roomId") ?? "";
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const [row] = await db
    .select()
    .from(personhoodProofs)
    .where(and(eq(personhoodProofs.roomId, roomId), eq(personhoodProofs.userId, auth.user.id)))
    .limit(1);

  const rpContext = worldIdRpContext();
  return NextResponse.json({
    verified: Boolean(row),
    verificationLevel: row?.verificationLevel ?? null,
    verifiedAt: row?.verifiedAt ?? null,
    action: WORLD_ID_ACTION,
 // the widget can only run with real credentials AND a signed RP context
    mode: worldIdConfigured() && rpContext ? "world-id" : "dev-simulator",
    rpContext,
  });
}

/**
 * POST → records that this member is a unique human.
 *
 * With a Developer Portal app_id the IDKit proof is checked against the
 * Worldcoin cloud verifier. Without one the route runs its dev simulator and
 * derives the nullifier server-side — the client cannot choose it either way,
 * so a party can never smuggle in a nullifier that isn't theirs.
 *
 * The proof is bound to this relationship: the signal is the relationId, so a
 * proof is not portable to another room.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as Partial<IdKitProof> & { roomId?: string };
  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  const signal = relationIdFromRoom(roomId);
  let nullifierHash: string;
  let verificationLevel: string;

  if (worldIdConfigured()) {
    if (!body.proof || !body.merkle_root || !body.nullifier_hash)
      return NextResponse.json({ error: "World ID proof required" }, { status: 400 });
    const result = await verifyCloudProof(
      {
        proof: body.proof,
        merkle_root: body.merkle_root,
        nullifier_hash: body.nullifier_hash,
        verification_level: body.verification_level ?? "orb",
      },
      signal
    ).catch((err: Error) => ({ ok: false as const, error: err.message }));
    if (!result.ok)
      return NextResponse.json({ error: result.error ?? "proof rejected" }, { status: 400 });
    nullifierHash = result.nullifierHash!;
    verificationLevel = result.verificationLevel ?? "orb";
  } else {
    nullifierHash = devNullifier(auth.user.id, WORLD_ID_ACTION);
    verificationLevel = "dev-simulator";
  }

  await db
    .insert(personhoodProofs)
    .values({ roomId, userId: auth.user.id, nullifierHash, verificationLevel })
    .onConflictDoUpdate({
      target: [personhoodProofs.roomId, personhoodProofs.userId],
      set: { nullifierHash, verificationLevel, verifiedAt: new Date() },
    });

  return NextResponse.json({ verified: true, verificationLevel, action: WORLD_ID_ACTION });
}
