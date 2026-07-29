/**
 * Seal — the promise made physical.
 *
 * Today a relationship's memories are kept apart by `okf_acl` rows and a
 * `WHERE` clause the server chooses to honor (`app/src/lib/okf-acl.ts`). That
 * is a promise: flip a row, or read the disk directly, and the isolation is
 * gone. Seal replaces the promise with arithmetic. Memory bytes are
 * threshold-encrypted under an identity derived from the RelationalAgent object
 * id, and the key servers will only hand out shares to an address that passes
 * `seal_approve` on chain — the same `members` check the Move module already
 * enforces for writes.
 *
 * The consequence we care about: the operator holding the Walrus blob holds
 * ciphertext. There is no admin bypass to build, because there is no key to
 * bypass with.
 *
 * Verified against Sui testnet by `sui/scripts/walrus-seal.mjs`; results in
 * `sui/PROOF.md`.
 */

import { SealClient, SessionKey } from "@mysten/seal";
import { Transaction } from "@mysten/sui/transactions";

import { RELATIONAL_AGENT_MODULE } from "./agent";
import { getBlob, putBlob, type PutBlobOptions } from "./walrus";

/**
 * Seal's testnet key servers. Two of two must independently agree the requester
 * passes `seal_approve`, so compromising one server buys an attacker nothing.
 */
export const SEAL_TESTNET_KEY_SERVERS = [
  {
    objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    weight: 1,
  },
  { objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", weight: 1 },
];

export const SEAL_THRESHOLD = 2;

/** The client shape both `@mysten/seal` and the tx builder need. */
type SuiClientLike = ConstructorParameters<typeof SealClient>[0]["suiClient"];

/** Anything that can sign the session-key personal message: a keypair, a wallet. */
type SignerLike = NonNullable<Parameters<typeof SessionKey.create>[0]["signer"]>;

export interface SealContext {
  suiClient: SuiClientLike;
  packageId: string;
  /** Object id of the shared `RelationalAgent` this memory belongs to. */
  agentId: string;
}

/**
 * The Seal identity for one memory: the agent's object id, then a per-memory
 * suffix. `seal_approve` checks the object id is a *prefix* of the identity, so
 * a key derived for this relationship cannot be requested through another
 * object — being in some couple never unlocks a different couple's blob.
 */
export function sealIdentity(agentId: string, suffix = ""): string {
  return `${agentId.startsWith("0x") ? agentId.slice(2) : agentId}${suffix}`;
}

function newSealClient(suiClient: SuiClientLike): SealClient {
  // A fresh client per operation on purpose: SealClient caches derived keys in
  // memory, and a cache shared across users would let one member's key satisfy
  // another user's read without any key server ever being asked.
  return new SealClient({ suiClient, serverConfigs: SEAL_TESTNET_KEY_SERVERS });
}

/** The transaction the key servers dry-run before releasing a share. Never executed. */
export function buildSealApprovalBytes(
  ctx: SealContext,
  identityHex: string,
  sender: string,
): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({
    target: `${ctx.packageId}::${RELATIONAL_AGENT_MODULE}::seal_approve`,
    arguments: [tx.pure.vector("u8", Array.from(hexToBytes(identityHex))), tx.object(ctx.agentId)],
  });
  return tx.build({ client: ctx.suiClient, onlyTransactionKind: true });
}

export interface SealedMemory {
  blobId: string;
  /** The Seal identity these bytes were sealed under, without the `0x`. */
  identityHex: string;
  ciphertextBytes: number;
}

/**
 * Seal the bytes, then store the *ciphertext* on Walrus. The returned `blobId`
 * is what `addMemoryTx` writes into the on-chain object.
 */
export async function sealEncryptToWalrus(
  ctx: SealContext,
  data: Uint8Array,
  options: { suffix?: string; walrus?: PutBlobOptions } = {},
): Promise<SealedMemory> {
  const identityHex = sealIdentity(ctx.agentId, options.suffix ?? "");
  const { encryptedObject } = await newSealClient(ctx.suiClient).encrypt({
    threshold: SEAL_THRESHOLD,
    packageId: ctx.packageId,
    id: identityHex,
    data,
  });
  const blobId = await putBlob(encryptedObject, options.walrus);
  return { blobId, identityHex, ciphertextBytes: encryptedObject.length };
}

/**
 * Fetch the blob and decrypt it — which only succeeds if the key servers, after
 * dry-running `seal_approve`, agree `reader` is a member of this relationship.
 * A non-member gets `NoAccessError` from `@mysten/seal`; there is nothing this
 * module can do about that, which is the point.
 */
export async function sealDecryptFromWalrus(
  ctx: SealContext,
  memory: { blobId: string; identityHex: string },
  reader: { address: string; signer: SignerLike },
  options: { ttlMin?: number } = {},
): Promise<Uint8Array> {
  const sessionKey = await SessionKey.create({
    address: reader.address,
    packageId: ctx.packageId,
    ttlMin: options.ttlMin ?? 10,
    signer: reader.signer,
    suiClient: ctx.suiClient,
  });
  const txBytes = await buildSealApprovalBytes(ctx, memory.identityHex, reader.address);
  const data = await getBlob(memory.blobId);
  return newSealClient(ctx.suiClient).decrypt({ data, sessionKey, txBytes });
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
