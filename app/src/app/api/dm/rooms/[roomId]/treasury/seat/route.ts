import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { claimSeat } from "@/lib/agent/treasury/approvals";
import { TREASURY_SEAT_ACTION } from "@/lib/agent/treasury/types";
import { devNullifier, verifyCloudProof, worldIdConfigured, type IdKitProof } from "@/lib/worldid";

export const dynamic = "force-dynamic";

/**
 * POST → claim this member's seat (the right to approve treasury actions).
 *
 * With a Developer Portal app_id the IDKit proof is verified by the cloud
 * verifier for TREASURY_SEAT_ACTION with signal = roomId, so a proof is bound
 * to this relation. Without one the dev simulator derives the nullifier
 * server-side. Either way the nullifier is never taken from the client.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  let nullifierHash: string;
  let verificationLevel: string;

  if (worldIdConfigured()) {
    const body = (await req.json().catch(() => ({}))) as Partial<IdKitProof>;
    if (!body.proof || !body.merkle_root || !body.nullifier_hash)
      return NextResponse.json(
        { reason: "proof-rejected", message: "World ID proof required" },
        { status: 400 }
      );
    const result = await verifyCloudProof(
      {
        proof: body.proof,
        merkle_root: body.merkle_root,
        nullifier_hash: body.nullifier_hash,
        verification_level: body.verification_level ?? "orb",
      },
      roomId,
      TREASURY_SEAT_ACTION
    ).catch((err: Error) => ({ ok: false as const, error: err.message, nullifierHash: undefined, verificationLevel: undefined }));
    if (!result.ok || !result.nullifierHash)
      return NextResponse.json(
        { reason: "proof-rejected", message: result.error ?? "World ID proof rejected" },
        { status: 400 }
      );
    nullifierHash = result.nullifierHash;
    verificationLevel = result.verificationLevel ?? "orb";
  } else {
    nullifierHash = devNullifier(auth.user.id, `${TREASURY_SEAT_ACTION}:${roomId}`);
    verificationLevel = "dev-simulator";
  }

  const seat = await claimSeat({ roomId, userId: auth.user.id, nullifierHash, verificationLevel });
  if (seat.ok) return NextResponse.json({ ok: true, level: seat.level });
  const status = seat.reason === "same-human" ? 409 : seat.reason === "not-member" ? 403 : 400;
  return NextResponse.json({ reason: seat.reason, message: seat.message }, { status });
}
