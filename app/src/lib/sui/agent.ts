/**
 * The relational agent as a Sui object — the transaction builders the app uses
 * to birth, feed, and dissolve one.
 *
 * On EVM the agent is a token id in a registry mapping and isolation is a
 * Postgres ACL the server chooses to honor. On Sui the agent *is* the object:
 * `members` lives on it, and every mutation is checked by the Move module
 * (sui/move/sources/relational_agent.move) rather than by us. `seal_approve` is
 * the same membership check, exposed for Seal's key servers so a non-member
 * cannot derive the key for a memory blob at all.
 *
 * These helpers are deliberately dependency-free: they take any object shaped
 * like `@mysten/sui`'s `Transaction`, so this module type-checks whether or not
 * the SDK is installed, and the same builders work in the browser (wallet
 * signing) and on the server (sponsor signing).
 */

/** The shared `Clock`, at a fixed address on every Sui network. */
export const SUI_CLOCK_OBJECT_ID = "0x6";

export const RELATIONAL_AGENT_MODULE = "relational_agent";

/** Status values mirrored from the Move module. */
export const AGENT_ACTIVE = 0;
export const AGENT_DISSOLVED = 1;

/** The structural subset of `@mysten/sui`'s `Transaction` we rely on. */
export interface SuiTransactionLike {
  moveCall(input: { target: string; arguments: unknown[] }): unknown;
  object(id: string): unknown;
  pure: {
    address(value: string): unknown;
    string(value: string): unknown;
    vector(type: "u8", value: Uint8Array | number[]): unknown;
  };
}

export interface AgentTxTarget {
  /** The published `relational_agent` package id. */
  packageId: string;
}

export interface CreateAgentInput extends AgentTxTarget {
  memberA: string;
  memberB: string;
}

export interface AddMemoryInput extends AgentTxTarget {
  /** Object id of the shared `RelationalAgent`. */
  agentId: string;
  /** Walrus blob id of the *ciphertext* — plaintext never reaches the chain. */
  blobId: string;
  /** "date" | "note" | "photo" — free-form, kept as the Move module keeps it. */
  kind: string;
}

export interface DissolveAgentInput extends AgentTxTarget {
  agentId: string;
}

export interface SealApproveInput extends AgentTxTarget {
  agentId: string;
  /** Seal identity being unlocked: the object id bytes, plus any suffix. */
  identity: Uint8Array;
}

function target(packageId: string, fn: string): string {
  return `${packageId}::${RELATIONAL_AGENT_MODULE}::${fn}`;
}

/**
 * Birth by mutual consent. Put this in one PTB that *both* members sign — the
 * chain then refuses to produce an agent only one of them agreed to, which is
 * the guarantee the EIP-712 `_recover` loop only approximates.
 */
export function buildCreateAgentTx(
  tx: SuiTransactionLike,
  { packageId, memberA, memberB }: CreateAgentInput,
): SuiTransactionLike {
  tx.moveCall({
    target: target(packageId, "create"),
    arguments: [
      tx.pure.address(memberA),
      tx.pure.address(memberB),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** Append one sealed memory. The Move module rejects a non-member sender. */
export function addMemoryTx(
  tx: SuiTransactionLike,
  { packageId, agentId, blobId, kind }: AddMemoryInput,
): SuiTransactionLike {
  tx.moveCall({
    target: target(packageId, "add_memory"),
    arguments: [
      tx.object(agentId),
      tx.pure.string(blobId),
      tx.pure.string(kind),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

/** It takes two to close what two opened; the object is stamped, never burned. */
export function dissolveAgentTx(
  tx: SuiTransactionLike,
  { packageId, agentId }: DissolveAgentInput,
): SuiTransactionLike {
  tx.moveCall({
    target: target(packageId, "dissolve"),
    arguments: [tx.object(agentId), tx.object(SUI_CLOCK_OBJECT_ID)],
  });
  return tx;
}

/**
 * The transaction Seal key servers dry-run before releasing a key share. We
 * never execute it; we hand its bytes to `SealClient.decrypt`.
 */
export function sealApproveTx(
  tx: SuiTransactionLike,
  { packageId, agentId, identity }: SealApproveInput,
): SuiTransactionLike {
  tx.moveCall({
    target: target(packageId, "seal_approve"),
    arguments: [tx.pure.vector("u8", identity), tx.object(agentId)],
  });
  return tx;
}

/** The Seal identity for a memory of this relationship: the object id bytes. */
export function sealIdentityFor(agentId: string): Uint8Array {
  const hex = agentId.startsWith("0x") ? agentId.slice(2) : agentId;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Shape of the on-chain object as `SuiClient.getObject` returns its fields. */
export interface RelationalAgentFields {
  members: { fields: { contents: string[] } } | { contents: string[] };
  status: number;
  memories: Array<{ fields?: MemoryRefFields } & Partial<MemoryRefFields>>;
  created_at_ms: string;
  dissolved_at_ms: string;
}

export interface MemoryRefFields {
  blob_id: string;
  kind: string;
  created_at_ms: string;
}

export function suiPackageId(): string {
  return process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ?? process.env.SUI_PACKAGE_ID ?? "";
}

export function suiRpcUrl(): string {
  return process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443";
}

/** Explorer link for a digest or object id — used in the timeline receipts. */
export function suiExplorerTxUrl(digest: string, network = "testnet"): string {
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

export function suiExplorerObjectUrl(objectId: string, network = "testnet"): string {
  return `https://suiscan.xyz/${network}/object/${objectId}`;
}
