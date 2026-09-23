/**
 * The live path: what the running product actually writes to Sui.
 *
 * `agent.ts`, `seal.ts` and `walrus.ts` are the primitives; this module is the
 * one place that holds a key, spends gas, and touches the database. Two things
 * happen here, both hung off events the product already had:
 *
 *   1. consent completes  → `create(memberA, memberB)` mints the shared
 *      RelationalAgent object, and its id is stored on the room;
 *   2. the agent files a memory → the same bytes the OKF write appended are
 *      Seal-encrypted to that object's identity, pushed to Walrus, and the
 *      blob id is appended on chain with `add_memory`.
 *
 * Everything is best-effort. Every export returns null instead of throwing, so
 * a slow key server or an empty gas coin can never turn a valid consent or a
 * successful document write into a failed request. Sui is an additional
 * record here, never the system of record — the OKF file and `okf_acl` are
 * untouched by any of this.
 *
 * Gas: the sponsor pays for everything, but it is not a member of any
 * relationship, and the Move module rejects a non-member `add_memory`. So a
 * memory is a sponsored transaction — the member signs as sender, the sponsor
 * signs as gas owner, and the chain sees exactly what it should: a person
 * writing to their own relationship.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";

import { db } from "@/lib/db";
import { chatRooms, users } from "@/lib/db/schema";

import { SUI_CLOCK_OBJECT_ID, RELATIONAL_AGENT_MODULE } from "./agent";
import { sealEncryptToWalrus } from "./seal";

/** Enough to cover a create or an add_memory with room to spare. */
const GAS_BUDGET = 100_000_000;

type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

function network(): SuiNetwork {
  const n = process.env.SUI_NETWORK ?? "testnet";
  return (["mainnet", "testnet", "devnet", "localnet"] as const).includes(n as SuiNetwork)
    ? (n as SuiNetwork)
    : "testnet";
}

export function suiPackage(): string | null {
  return process.env.SUI_PACKAGE_ID || null;
}

/** Configured means: we have a package to call and a key to pay with. */
export function suiLiveEnabled(): boolean {
  return Boolean(suiPackage() && process.env.SUI_SPONSOR_KEY);
}

/**
 * gRPC, not JSON-RPC: the fullnode's JSON-RPC endpoint now answers 404, and
 * gRPC is the transport `sui/scripts/walrus-seal.mjs` was proven against.
 */
let clientMemo: SuiGrpcClient | null = null;
export function suiLiveClient(): SuiGrpcClient {
  clientMemo ??= new SuiGrpcClient({
    network: network(),
    baseUrl: process.env.SUI_RPC_URL || `https://fullnode.${network()}.sui.io:443`,
  });
  return clientMemo;
}

let sponsorMemo: Ed25519Keypair | null = null;
function sponsor(): Ed25519Keypair | null {
  const key = process.env.SUI_SPONSOR_KEY;
  if (!key) return null;
  try {
    sponsorMemo ??= Ed25519Keypair.fromSecretKey(key);
    return sponsorMemo;
  } catch (err) {
    console.error("sui: SUI_SPONSOR_KEY is not a usable secret key:", err);
    return null;
  }
}

/**
 * One chain write at a time. Every transaction here is paid from the same
 * sponsor address, and two in flight at once would try to spend the same gas
 * coin — the second fails with an equivocation error that has nothing to do
 * with what it was trying to record.
 */
let chainQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = chainQueue.catch(() => undefined).then(work);
  chainQueue = next.catch(() => undefined);
  return next;
}

/** Gas coins belonging to the sponsor. */
async function sponsorGasPayment(address: string) {
  const { objects } = await suiLiveClient().listCoins({ owner: address, coinType: "0x2::sui::SUI" });
  if (!objects.length) throw new Error(`sui sponsor ${address} has no SUI to pay gas with`);
  return objects
    .slice(0, 8)
    .map((c) => ({ objectId: c.objectId, version: c.version, digest: c.digest }));
}

/**
 * Build, sign and run a sponsored transaction. `senderKey` signs as the sender
 * (the member, whom the Move module checks); the sponsor signs for gas. When
 * `senderKey` is the sponsor itself this degenerates to an ordinary single
 * signature, which is what `create` wants.
 */
async function executeSponsored(
  build: (tx: Transaction) => void,
  senderKey: Ed25519Keypair
): Promise<{ digest: string; createdShared: string[] } | null> {
  const payer = sponsor();
  if (!payer) return null;
  const client = suiLiveClient();
  const sender = senderKey.toSuiAddress();
  const payerAddress = payer.toSuiAddress();

  const tx = new Transaction();
  build(tx);
  tx.setSender(sender);
  tx.setGasOwner(payerAddress);
  tx.setGasBudget(GAS_BUDGET);
  tx.setGasPayment(await sponsorGasPayment(payerAddress));

  const bytes = await tx.build({ client });
  const signatures = [(await senderKey.signTransaction(bytes)).signature];
  if (sender !== payerAddress) signatures.push((await payer.signTransaction(bytes)).signature);

  const res = await client.executeTransaction({
    transaction: bytes,
    signatures,
    include: { effects: true },
  });
 // The result is a union: a rejected transaction carries no digest we can
 // follow, so say so rather than reporting a half-success.
  if (res.$kind !== "Transaction") {
    throw new Error(`sui rejected the transaction: ${JSON.stringify(res.FailedTransaction)}`);
  }
  const { digest, effects } = res.Transaction;
  await client.waitForTransaction({ digest });
  if (effects && !effects.status.success) {
    throw new Error(`sui tx ${digest} failed: ${effects.status.error}`);
  }
  const createdShared = (effects?.changedObjects ?? [])
    .filter((c) => c.idOperation === "Created" && c.outputOwner?.$kind === "Shared")
    .map((c) => c.objectId);
  return { digest, createdShared };
}

/**
 * This person's Sui address, generated on first need and kept afterwards. A
 * human who never takes part in a consented relationship never gets one.
 */
export async function ensureUserSuiKeypair(userId: string): Promise<Ed25519Keypair | null> {
  const [row] = await db
    .select({ suiAddress: users.suiAddress, encryptedSuiKey: users.encryptedSuiKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  if (row.encryptedSuiKey) {
    try {
      return Ed25519Keypair.fromSecretKey(row.encryptedSuiKey);
    } catch (err) {
      console.error(`sui: stored key for user ${userId} is unusable:`, err);
      return null;
    }
  }
  const kp = Ed25519Keypair.generate();
  await db
    .update(users)
    .set({ suiAddress: kp.toSuiAddress(), encryptedSuiKey: kp.getSecretKey() })
    .where(eq(users.id, userId));
  return kp;
}

export interface SuiRelationship {
  objectId: string;
  digest: string;
}

/**
 * Birth on Sui: the relationship becomes a shared object owned by neither
 * person alone. Idempotent per room — a room that already has an object id
 * keeps it. Returns null (quietly) whenever the chain is not available.
 */
export async function createRelationshipOnSui(
  roomId: string,
  memberUserIds: string[]
): Promise<SuiRelationship | null> {
  const packageId = suiPackage();
  const payer = sponsor();
  if (!packageId || !payer) return null;
  if (memberUserIds.length < 2) return null;

  const [room] = await db
    .select({ suiObjectId: chatRooms.suiObjectId, suiCreateTx: chatRooms.suiCreateTx })
    .from(chatRooms)
    .where(eq(chatRooms.id, roomId))
    .limit(1);
  if (room?.suiObjectId) return { objectId: room.suiObjectId, digest: room.suiCreateTx ?? "" };

  const pair = memberUserIds.slice(0, 2);
  const keys = await Promise.all(pair.map(ensureUserSuiKeypair));
  const [a, b] = keys;
  if (!a || !b) return null;
  const memberA = a.toSuiAddress();
  const memberB = b.toSuiAddress();
  if (memberA === memberB) return null; // the Move module asserts this too

  const res = await serialize(() =>
    executeSponsored((tx) => {
      tx.moveCall({
        target: `${packageId}::${RELATIONAL_AGENT_MODULE}::create`,
        arguments: [
          tx.pure.address(memberA),
          tx.pure.address(memberB),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    }, payer)
  );
  if (!res) return null;

 // `create` shares exactly one object, so the single created shared object in
 // this transaction's effects is the relationship.
  const objectId = res.createdShared[0];
  if (!objectId) return null;

  await db
    .update(chatRooms)
    .set({ suiObjectId: objectId, suiCreateTx: res.digest, suiMemberIds: pair })
    .where(eq(chatRooms.id, roomId));
  return { objectId, digest: res.digest };
}

export interface SuiMemoryReceipt {
  objectId: string;
  blobId: string;
  digest: string;
  identityHex: string;
  ciphertextBytes: number;
}

/**
 * One sealed memory: encrypt to this relationship's identity, park the
 * ciphertext on Walrus, then point the object at the blob. The plaintext never
 * leaves this process and the blob the storage operator holds is unreadable
 * without a key server agreeing the reader passes `seal_approve`.
 *
 * `authorUserId` must be one of the two members — they sign as sender, so the
 * chain records who wrote it and rejects anyone else.
 */
export async function fileSealedMemoryOnSui(input: {
  roomId: string;
  bytes: Uint8Array;
  kind: string;
}): Promise<SuiMemoryReceipt | null> {
  const packageId = suiPackage();
  if (!packageId || !sponsor()) return null;

  const [room] = await db
    .select({ suiObjectId: chatRooms.suiObjectId, suiMemberIds: chatRooms.suiMemberIds })
    .from(chatRooms)
    .where(eq(chatRooms.id, input.roomId))
    .limit(1);
  const objectId = room?.suiObjectId;
  if (!objectId) return null; // no object yet — nothing to append to

 // Signed by one of the two the object was born with — anyone else is refused
 // by the Move module, which is the whole point of putting it there.
  const author = room?.suiMemberIds?.length
    ? await ensureUserSuiKeypair(room.suiMemberIds[0])
    : null;
  if (!author) return null;

  const sealed = await sealEncryptToWalrus(
    { suiClient: suiLiveClient(), packageId, agentId: objectId },
    input.bytes,
    { suffix: Date.now().toString(16) }
  );

  const res = await serialize(() =>
    executeSponsored((tx) => {
      tx.moveCall({
        target: `${packageId}::${RELATIONAL_AGENT_MODULE}::add_memory`,
        arguments: [
          tx.object(objectId),
          tx.pure.string(sealed.blobId),
          tx.pure.string(input.kind),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    }, author)
  );
  if (!res) return null;
  return {
    objectId,
    blobId: sealed.blobId,
    digest: res.digest,
    identityHex: sealed.identityHex,
    ciphertextBytes: sealed.ciphertextBytes,
  };
}

/** The room's object id, for the UI. Null until consent has put one there. */
export async function suiObjectIdForRoom(roomId: string): Promise<string | null> {
  const [room] = await db
    .select({ suiObjectId: chatRooms.suiObjectId })
    .from(chatRooms)
    .where(eq(chatRooms.id, roomId))
    .limit(1);
  return room?.suiObjectId ?? null;
}
