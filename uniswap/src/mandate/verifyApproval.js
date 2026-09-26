import { recoverMandateSigner } from "./verify.js";
import { sameAddress } from "../address.js";

/**
 * Does this mandate's stored approval still hold? Pure; answers only from the mandate itself.
 *
 * `check` asks whether an approval exists; this is what makes the answer mean something. The
 * passbook is a plain JSON file written by the agent's own process, so an approval that is merely
 * a truthy field proves nothing about the family — only re-recovering the signature does. The
 * eleven signed fields exclude `approval` and `revokedAt`, so a stored mandate re-verifies for as
 * long as its terms are untouched.
 *
 * False, not a throw: an approval that cannot be checked is a refusal the family reads in the
 * passbook, and every way of failing (no approval, a ref that is not a signature, a subject that
 * did not sign) has to reach them the same way.
 */
export async function verifyApproval(m, chainId) {
  const approval = m?.approval;
  if (!approval) return false;
  // Slice 1 knows one method. Another (a World ID step-up) plugs in by adding a branch here; until
  // it does, a method this package cannot check is not an approval it may act on.
  if (approval.method !== "wallet-signature") return false;
  let signer;
  try { signer = await recoverMandateSigner(m, chainId, approval.ref); }
  catch { return false; }
  return sameAddress(signer, approval.subject);
}
