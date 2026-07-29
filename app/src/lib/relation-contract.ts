/**
 * The relational agent contract — EIP-712 typed data both members sign so the
 * agent can be born. The shape matches contracts/RelationalAgentRegistry.sol
 * exactly (struct RelationConsent + domain), so the signatures collected
 * here can be relayed on-chain via registerRelationalAgent() unchanged and
 * registered into the ERC-8004-compatible identity registry.
 *
 * Shared by client (signs) and server (verifies) — keep dependency-light.
 */

import { keccak256, stringToBytes } from "viem";

export const RELATION_CONSENT_TYPES = {
  RelationConsent: [
    { name: "relationId", type: "bytes32" },
    { name: "parties", type: "address[]" },
  ],
} as const;

/** The human-backed registry — the deployment that also binds a World ID
 * nullifier per party. Setting it turns personhood on: consent requires a
 * proof, and the relay registers through registerHumanBackedAgent. Unset, the
 * app runs the original registry unchanged. */
export function humanBackedRegistryAddress(): `0x${string}` | null {
  const a = process.env.NEXT_PUBLIC_HUMANBACKED_REGISTRY_ADDRESS;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) && !/^0x0+$/.test(a) ? (a as `0x${string}`) : null;
}

/** The registry the signatures anchor to — the human-backed deployment when
 * configured, else the legacy one. Both compute their EIP-712 domain from
 * their own address, so this choice must be identical on client and server. */
export function relationRegistryAddress(): `0x${string}` {
  return (
    humanBackedRegistryAddress() ??
    ((process.env.NEXT_PUBLIC_RELATION_REGISTRY_ADDRESS ??
      "0x0000000000000000000000000000000000000000") as `0x${string}`)
  );
}

/** Must mirror the constructor of RelationalAgentRegistry.sol. Until the
 * registry is deployed the zero address stands in; signatures then anchor to
 * the future deployment's domain via env. */
export function relationConsentDomain() {
  return {
    name: "RelationalAgentRegistry",
    version: "1",
    chainId: Number(process.env.NEXT_PUBLIC_RELATION_REGISTRY_CHAIN_ID ?? 11155111),
    verifyingContract: relationRegistryAddress(),
  } as const;
}

/** Stable bytes32 for a room — keccak256 of the room's uuid string. */
export function relationIdFromRoom(roomId: string): `0x${string}` {
  return keccak256(stringToBytes(roomId));
}

export const RELATION_DISSOLVE_TYPES = {
  RelationDissolve: [
    { name: "relationId", type: "bytes32" },
    { name: "parties", type: "address[]" },
  ],
} as const;

export interface RelationConsentTypedData {
  domain: ReturnType<typeof relationConsentDomain>;
  types: typeof RELATION_CONSENT_TYPES;
  primaryType: "RelationConsent";
  message: {
    relationId: `0x${string}`;
    parties: `0x${string}`[];
  };
}

/** Canonical consent payload for a room — couples and groups alike. Parties
 * are lowercased and sorted ascending (the order the registry requires), so
 * every signer sees the identical struct. */
export function buildRelationConsentTypedData(
  roomId: string,
  memberAddresses: string[]
): RelationConsentTypedData {
  const parties = [...memberAddresses]
    .map((x) => x.toLowerCase() as `0x${string}`)
    .sort();
  return {
    domain: relationConsentDomain(),
    types: RELATION_CONSENT_TYPES,
    primaryType: "RelationConsent",
    message: { relationId: relationIdFromRoom(roomId), parties },
  };
}

export interface RelationDissolveTypedData {
  domain: ReturnType<typeof relationConsentDomain>;
  types: typeof RELATION_DISSOLVE_TYPES;
  primaryType: "RelationDissolve";
  message: {
    relationId: `0x${string}`;
    parties: `0x${string}`[];
  };
}

/** Closing mirrors opening: the identical party set signs a RelationDissolve
 * over the same domain, relayable to dissolveRelationalAgent() unchanged. */
export function buildRelationDissolveTypedData(
  roomId: string,
  memberAddresses: string[]
): RelationDissolveTypedData {
  const parties = [...memberAddresses]
    .map((x) => x.toLowerCase() as `0x${string}`)
    .sort();
  return {
    domain: relationConsentDomain(),
    types: RELATION_DISSOLVE_TYPES,
    primaryType: "RelationDissolve",
    message: { relationId: relationIdFromRoom(roomId), parties },
  };
}
