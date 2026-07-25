import "server-only";
import { keccak256, stringToBytes } from "viem";

/**
 * World ID proof-of-personhood, server side.
 *
 * A World ID proof yields a `nullifier_hash`: a per-(app, action) identifier
 * derived from a real human's identity commitment. Two proofs from the same
 * person for the same action collide; proofs from two different people never
 * do. That is exactly the primitive a relational agent needs — "two DIFFERENT
 * real people agreed" — and it reveals nothing about who they are.
 *
 * Two modes:
 *   - production: WORLD_ID_APP_ID is set → the proof is checked against the
 *     Worldcoin cloud verifier, which is the authority on whether the ZK proof
 *     is valid for this app+action.
 *   - dev-simulator: no Developer Portal credentials → the server derives a
 *     deterministic per-user nullifier itself. Everything downstream (the
 *     consent gate, the on-chain binding, the seller's isHumanBacked check) is
 *     byte-for-byte the same path; only the issuer of the nullifier differs.
 */

export const WORLD_ID_ACTION = process.env.WORLD_ID_ACTION ?? "relation-consent";

export function worldIdAppId(): string | null {
  const id = process.env.WORLD_ID_APP_ID;
  return id && id.startsWith("app_") ? id : null;
}

/** True when real World ID credentials are configured (cloud verify path). */
export function worldIdConfigured(): boolean {
  return worldIdAppId() !== null;
}

/**
 * The RP context IDKit v4 needs: a registered relying-party id plus a
 * signature the Developer Portal issues. It is server-only by construction —
 * the client is handed one, never asked to build one. Provided as JSON in
 * WORLD_ID_RP_CONTEXT; null means the widget cannot run and the caller falls
 * back to the dev simulator.
 */
export function worldIdRpContext(): Record<string, unknown> | null {
  const raw = process.env.WORLD_ID_RP_CONTEXT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed?.rp_id === "string" ? parsed : null;
  } catch {
    console.error("WORLD_ID_RP_CONTEXT is not valid JSON");
    return null;
  }
}

export interface IdKitProof {
  proof: string;
  merkle_root: string;
  nullifier_hash: string;
  verification_level: string;
}

export interface VerifyResult {
  ok: boolean;
  nullifierHash?: string;
  verificationLevel?: string;
  error?: string;
}

/**
 * The dev-simulator nullifier. Deterministic per user, so re-verifying is
 * idempotent and two distinct users can never collide — the same guarantees
 * the real nullifier gives, minus the proof that a human is behind the id.
 */
export function devNullifier(userId: string, action: string): string {
  return keccak256(stringToBytes(`dev:${userId}:${action}`));
}

/**
 * Verifies an IDKit proof against the Worldcoin cloud verifier.
 * `signal` binds the proof to this specific relationship (the relationId), so a
 * proof harvested for one relationship cannot be replayed into another.
 */
export async function verifyCloudProof(
  proof: IdKitProof,
  signal: string
): Promise<VerifyResult> {
  const appId = worldIdAppId();
  if (!appId) return { ok: false, error: "World ID is not configured" };
  const { hashSignal } = await import("@worldcoin/idkit-core/hashing");

  const res = await fetch(`https://developer.worldcoin.org/api/v2/verify/${appId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nullifier_hash: proof.nullifier_hash,
      merkle_root: proof.merkle_root,
      proof: proof.proof,
      verification_level: proof.verification_level,
      action: WORLD_ID_ACTION,
      signal_hash: hashSignal(signal),
    }),
  }).catch((err) => {
    throw new Error(`World ID verifier unreachable: ${err}`);
  });

  const body = (await res.json().catch(() => ({}))) as { detail?: string; code?: string };
  if (!res.ok) return { ok: false, error: body.detail ?? body.code ?? `verifier ${res.status}` };
  return {
    ok: true,
    nullifierHash: proof.nullifier_hash,
    verificationLevel: proof.verification_level,
  };
}

/** A nullifier hash as the uint256 the registry stores. */
export function nullifierToUint(nullifierHash: string): bigint {
  return BigInt(nullifierHash);
}
