/**
 * EIP-712 payload for a SpendMandate — the same mechanism the app uses for RelationConsent
 * (app/src/lib/relation-contract.ts). A member signs it in their wallet; the agent never can,
 * because it never holds a member's key.
 */
export const SPEND_MANDATE_TYPES = {
  SpendMandate: [
    { name: "id", type: "string" },
    { name: "roomId", type: "string" },
    { name: "agent", type: "address" },
    { name: "kind", type: "string" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "perRunCap", type: "uint256" },
    { name: "perPeriodCap", type: "uint256" },
    { name: "period", type: "string" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

export function mandateDomain(chainId) {
  return { name: "ainmem Family Passbook", version: "1", chainId };
}

export function mandateTypedData(m, chainId) {
  return {
    domain: mandateDomain(chainId),
    types: SPEND_MANDATE_TYPES,
    primaryType: "SpendMandate",
    message: {
      id: m.id, roomId: m.roomId, agent: m.agent, kind: m.kind,
      tokenIn: m.tokenIn, tokenOut: m.tokenOut,
      perRunCap: m.perRunCap, perPeriodCap: m.perPeriodCap, period: m.period,
      expiresAt: BigInt(m.expiresAt), nonce: BigInt(m.nonce),
    },
  };
}
