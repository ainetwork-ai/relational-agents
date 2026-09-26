// GENERATED from ens/src/config.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/config.ts
// Pocket money by name — shared constants (ens/plan-family-namespace.md).
// Addresses: ENSv2 Sepolia Beta (docs.ens.domains/learn/deployments#sepolia-ensv2-beta).
import type { Address } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";

/** Circle's Sepolia USDC — what grandma sends. */
export const SEPOLIA_USDC: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const USDC_DECIMALS = 6;
/** Freely mintable test USDC — only pays the parent name's registration fee in the setup script. */
export const MOCK_USDC: Address = "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e";

export const UNIVERSAL_HELPER: Address = "0x33f571aa8a160a21b877cf6e0fb8806692b97df5";
export const VERIFIABLE_FACTORY: Address = "0x9e726eb570beb6bceb495ab8cda7df517d4e841c";
export const USER_REGISTRY_IMPL: Address = "0xa80338aaa8d23831cea25e858d1774534abb0263";
export const PERMISSIONED_RESOLVER_IMPL: Address = "0x14f09fd05d4585759e54844dc9b00147131cf243";
export const ETH_REGISTRAR: Address = "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca";
export const ETH_REGISTRY: Address = "0x657ea849311d3d5823348dded7c2aaafb3ede09e";

/** 0.01 USDC … 100 USDC, in 6-decimal units. */
export const MIN_SEND_MICRO = BigInt(10_000);
export const MAX_SEND_MICRO = BigInt(100_000_000);

export const RELATION_KEY = "family.relation";
export const ALIAS_KEY = "alias"; // ENSIP-18
export const AVATAR_KEY = "avatar";
export const CLASS_KEY = "class"; // ENSIP-27

export type Relation = "son" | "daughter" | "spouse";
export const RELATIONS: readonly Relation[] = ["son", "daughter", "spouse"];

/** A .eth registration year, in seconds (the registrar's duration unit). */
export const YEAR_SECONDS = BigInt(365 * 24 * 3600);
/** Every role and its admin in EnhancedAccessControl (one bit per nybble, EACBaseRolesLib.ALL_ROLES). */
export const ALL_ROLES = BigInt("0x" + "1".repeat(64));
