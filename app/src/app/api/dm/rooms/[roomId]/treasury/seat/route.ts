import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { requireRoomAccess } from "@/lib/chat-room-access";
import { claimSeat } from "@/lib/agent/treasury/approvals";
import { TREASURY_SEAT_ACTION } from "@/lib/agent/treasury/types";
import { devNullifier, verifyCloudProof, worldIdConfigured, type IdKitProof } from "@/lib/worldid";
import { canonicalNullifier, verifyIdKitV4, worldIdV4Config } from "@/lib/worldid-v4";

export const dynamic = "force-dynamic";

/**
 * The one protocol a World ID 4.0-path seat proof may come in. A 3.0 and a
 * 4.0 proof of the same human for the same action carry DIFFERENT nullifiers
 * (IDKit: with legacy proofs allowed "you must track both v3 and v4
 * nullifiers to prevent double-claims"), and a seat is unique on one
 * nullifier — accepting both would let one human sit twice, once per
 * protocol. 3.0, because the widget's orbLegacy preset only returns 3.0; the
 * request is built in the browser, so this is enforced here, not trusted from
 * how the client configured IDKit.
 */
const SEAT_PROTOCOL = "3.0";

/**
 * A seat is one HUMAN, so only a proof-of-human credential buys one: Orb in
 * 3.0 terms. A device-level proof for the same action and signal would verify
 * just as well, so the credential is checked here too.
 */
function isProofOfHuman(v: { protocolVersion: "3.0" | "4.0"; credential: string }): boolean {
  return v.protocolVersion === SEAT_PROTOCOL && v.credential === "orb";
}

function rejected(message: string) {
  return NextResponse.json({ reason: "proof-rejected", message }, { status: 400 });
}

/**
 * POST → claim this member's seat (the right to approve treasury actions).
 *
 * Three modes, first configured wins:
 *   1. World ID 4.0 (WORLD_RP_ID + WORLD_RP_SIGNING_KEY + app_id): body is
 *      { idkitResponse } — IDKit's result as-is, from an rp_context this server
 *      signed (./rp-context). Verified by the Portal for TREASURY_SEAT_ACTION,
 *      signal pinned to roomId, environment pinned to our config, protocol
 *      pinned to SEAT_PROTOCOL.
 *   2. World ID 3.0 (WORLD_ID_APP_ID): body is the v3 proof; the cloud verifier
 *      checks it for TREASURY_SEAT_ACTION with signal = roomId.
 *   3. Dev simulator: the nullifier is derived server-side per account. Not a
 *      proof of anything — the panel says so.
 * The signal is the roomId in every real mode, so a proof is bound to this
 * relation. The nullifier is only ever read from a verified proof, never taken
 * from the client on its own.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  const auth = await requireAuth();
  if ("error" in auth) return auth.error;
  const { roomId } = await ctx.params;
  const access = await requireRoomAccess(roomId, auth.user.id);
  if ("error" in access) return access.error;

  let nullifierHash: string;
  let verificationLevel: string;

  if (worldIdV4Config()) {
    const body = (await req.json().catch(() => ({}))) as { idkitResponse?: unknown };
    if (!body.idkitResponse) return rejected("World ID proof required");
    const result = await verifyIdKitV4(body.idkitResponse, TREASURY_SEAT_ACTION, { signal: roomId }).catch(
      (err: Error) => ({ ok: false as const, error: err.message })
    );
    if (!result.ok) return rejected(result.error);
    if (result.protocolVersion !== SEAT_PROTOCOL)
      return rejected(`A seat proof must be World ID ${SEAT_PROTOCOL} (one human, one nullifier) — this one is ${result.protocolVersion}`);
    if (!isProofOfHuman(result))
      return rejected(`A seat needs a proof of human (Orb) — this proof is "${result.credential}"`);
    nullifierHash = result.nullifier;
    verificationLevel = result.level;
  } else if (worldIdConfigured()) {
    const body = (await req.json().catch(() => ({}))) as Partial<IdKitProof>;
    if (!body.proof || !body.merkle_root || !body.nullifier_hash) return rejected("World ID proof required");
    const nullifier = canonicalNullifier(body.nullifier_hash);
    if (!nullifier) return rejected("World ID proof has a malformed nullifier");
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
    if (!result.ok || !result.nullifierHash) return rejected(result.error ?? "World ID proof rejected");
    verificationLevel = result.verificationLevel ?? "orb";
    if (verificationLevel !== "orb")
      return rejected(`A seat needs a proof of human (Orb) — this proof is "${verificationLevel}"`);
    // the verifier accepted this field element; store it in one spelling
    nullifierHash = nullifier;
  } else {
    nullifierHash = devNullifier(auth.user.id, `${TREASURY_SEAT_ACTION}:${roomId}`);
    verificationLevel = "dev-simulator";
  }

  const seat = await claimSeat({ roomId, userId: auth.user.id, nullifierHash, verificationLevel });
  if (seat.ok) return NextResponse.json({ ok: true, level: seat.level });
  const status = seat.reason === "same-human" ? 409 : seat.reason === "not-member" ? 403 : 400;
  return NextResponse.json({ reason: seat.reason, message: seat.message }, { status });
}
