import { mandateTypedData } from "./typedData.js";
import { recoverMandateSigner } from "./verify.js";

/**
 * A standing mandate for `agent`, signed by `member` (a viem account). Caps are token units
 * (bigint), `days` whole days from `now`. The signer is recovered once here so the stored
 * `approval.subject` is what the signature says, not what the caller claims.
 */
export async function signStandingMandate({ member, agent, chain, perRunCap, perPeriodCap, days,
                                            roomId = "room-demo", period = "week", now = new Date() }) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const m = {
    id: `m-${now.getTime()}`, roomId, agent, kind: "standing",
    tokenIn: chain.tokens.USDC.address, tokenOut: chain.tokens.WETH.address,
    perRunCap, perPeriodCap, period, expiresAt: nowSec + days * 86_400, nonce: now.getTime(),
  };
  const signature = await member.signTypedData(mandateTypedData(m, chain.chainId));
  const signer = await recoverMandateSigner(m, chain.chainId, signature);
  return { ...m, approval: { method: "wallet-signature", subject: signer, verifiedAt: nowSec, ref: signature } };
}
