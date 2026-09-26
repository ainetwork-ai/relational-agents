import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { seal, unseal } from "@/lib/secret-box";
import { agentKitFor, invokeAction, toPrivateKey, txHashFromActionResult } from "@/lib/agent/agentkit";

/**
 * The relation's treasury is the room agent's own Sepolia wallet.
 *
 * Amounts are spoken in USD and settled in SepETH at a disclosed testnet
 * scale (TREASURY_USD_PER_ETH, default $200,000 per ETH, so $1 = 0.000005
 * SepETH) — a $1,000 treasury fits in what a faucet hands out. Conversions go
 * through integer cents and wei so "$180" is exactly 0.0009 ETH, not a float
 * that drifts on the way back.
 *
 * Nothing here decides whether money may move: callers arrive only after the
 * policy evaluator and the approval quorum have said yes.
 */

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });

export const USD_PER_ETH: number = Number(process.env.TREASURY_USD_PER_ETH ?? 200000);

// BigInt() rather than literals: tsconfig targets below ES2020.
const WEI_PER_ETH = BigInt(10) ** BigInt(18);
const ZERO = BigInt(0);
const TWO = BigInt(2);
const RECEIPT_TIMEOUT_MS = 180_000;
/** 21000 for a plain transfer × AgentKit's default 1.2 gas-limit multiplier. */
const TRANSFER_GAS_UNITS = BigInt(25_200);
/** The most the funder adds for gas on one transfer — the sponsorship is disclosed, the principal never is. */
const GAS_SPONSOR_CAP = parseEther("0.0005");

function centsPerEth(): bigint {
  if (!Number.isFinite(USD_PER_ETH) || USD_PER_ETH <= 0)
    throw new Error("TREASURY_USD_PER_ETH must be a positive number");
  return BigInt(Math.round(USD_PER_ETH * 100));
}

function usdToWei(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`treasury: ${usd} is not a USD amount`);
  return (BigInt(Math.round(usd * 100)) * WEI_PER_ETH) / centsPerEth();
}

/** USD → decimal SepETH string at the demo scale (USD rounded to cents). */
export function usdToEth(usd: number): string {
  return formatEther(usdToWei(usd));
}

/** wei → USD at the demo scale, rounded to cents. */
export function ethToUsd(wei: bigint): number {
  return Number((wei * centsPerEth() + WEI_PER_ETH / TWO) / WEI_PER_ETH) / 100;
}

// ── the agent's key ─────────────────────────────────────────────────────────

/** gift.ts walletOf's format, "fw1:<address>:<sealed key>", sealed under this label. */
const FAMILY_WALLET_PREFIX = "fw1:";
const FAMILY_WALLET_LABEL = "family-wallet";
/**
 * A key minted (or re-sealed) here: "tw1:<address>:<sealed key>" under its own
 * label — sealed at rest like fw1, so a database dump alone moves no money,
 * but never fw1 itself: gift.ts finds x402 payers by `LIKE 'fw1:<address>:%'`.
 */
const TREASURY_PREFIX = "tw1:";
const TREASURY_LABEL = "treasury-wallet";

/** Is this stored key one this module sealed — i.e. does its agent hold a treasury? */
export function isTreasuryKey(stored: string | null | undefined): boolean {
  return Boolean(stored?.startsWith(TREASURY_PREFIX));
}

function sealedKey(key: Hex): string {
  return `${TREASURY_PREFIX}${privateKeyToAccount(key).address}:${seal(TREASURY_LABEL, key)}`;
}

function keyFromStored(stored: string, agentUserId: string): Hex {
  for (const [prefix, label] of [
    [TREASURY_PREFIX, TREASURY_LABEL],
    [FAMILY_WALLET_PREFIX, FAMILY_WALLET_LABEL],
  ] as const) {
    if (!stored.startsWith(prefix)) continue;
    const [, address, sealed] = stored.split(":");
    const plain = sealed ? unseal(label, sealed) : null;
    try {
      const key = toPrivateKey(plain ?? "");
      if (isAddress(address) && privateKeyToAccount(key).address === getAddress(address)) return key;
    } catch {
      // falls through to the error below
    }
    throw new Error(
      `treasury: agent ${agentUserId} holds a sealed (${prefix.slice(0, -1)}) key this server cannot unseal — check SESSION_SECRET. The stored key was left untouched.`
    );
  }
  try {
    return toPrivateKey(stored);
  } catch {
    throw new Error(
      `treasury: agent ${agentUserId} has a stored key that is neither 64-hex nor sealed — refusing to replace it.`
    );
  }
}

async function storedKeyOf(agentUserId: string): Promise<string | null> {
  const [u] = await db
    .select({ isAgent: users.isAgent, key: users.encryptedPrivateKey })
    .from(users)
    .where(eq(users.id, agentUserId))
    .limit(1);
  if (!u) throw new Error(`treasury: user ${agentUserId} does not exist`);
  if (!u.isAgent) throw new Error(`treasury: user ${agentUserId} is not an agent — only a room agent holds a treasury`);
  return u.key || null;
}

/**
 * The agent's private key, minted — sealed — on first use. Agents are born
 * keyless (provision.ts), and a key that already exists is never replaced:
 * the write is conditional on the column being empty, so two concurrent first
 * calls end up with the same key. A legacy plain-hex key is re-sealed in
 * place (same key, same address), conditional on the column still holding
 * exactly that hex; if that write fails the key still works as it is.
 */
export async function agentKey(agentUserId: string): Promise<Hex> {
  let stored = await storedKeyOf(agentUserId);
  if (!stored) {
    await db
      .update(users)
      .set({ encryptedPrivateKey: sealedKey(generatePrivateKey()) })
      .where(
        and(
          eq(users.id, agentUserId),
          or(isNull(users.encryptedPrivateKey), eq(users.encryptedPrivateKey, ""))
        )
      );
    stored = await storedKeyOf(agentUserId);
    if (!stored) throw new Error(`treasury: could not store a wallet key for agent ${agentUserId}`);
  }
  const key = keyFromStored(stored, agentUserId);
  if (!stored.includes(":")) {
    const plain = stored;
    await db
      .update(users)
      .set({ encryptedPrivateKey: sealedKey(key) })
      .where(and(eq(users.id, agentUserId), eq(users.encryptedPrivateKey, plain)))
      .catch((err: unknown) => console.error(`treasury: could not seal agent ${agentUserId}'s key (it still works):`, err));
  }
  return key;
}

/** The agent's treasury wallet address, generating its key if it has none. */
export async function ensureAgentWallet(agentUserId: string): Promise<{ address: `0x${string}` }> {
  const key = await agentKey(agentUserId);
  return { address: privateKeyToAccount(key).address };
}

export async function treasuryBalance(
  address: `0x${string}`
): Promise<{ wei: bigint; eth: string; usd: number }> {
  const wei = await pub.getBalance({ address });
  return { wei, eth: formatEther(wei), usd: ethToUsd(wei) };
}

const DISPLAY_BALANCE_FRESH_MS = 5_000;
const DISPLAY_BALANCE_STALE_MS = 60_000;
const displayBalances = new Map<string, { at: number; value?: { eth: string; usd: number }; inflight?: Promise<void> }>();

/**
 * The balance as the panel shows it: every viewer polls every few seconds, so
 * one RPC read per address per 5s is shared, and a poll never waits for the
 * chain while there is a value to show — one under 5 s old is returned as is,
 * an older one (up to a minute) is returned while a fresh read runs behind it.
 * Only a poll with nothing yet waits for the read. Never for a money decision —
 * those read treasuryBalance fresh.
 */
export async function displayBalance(address: `0x${string}`): Promise<{ eth: string; usd: number }> {
  const key = address.toLowerCase();
  let entry = displayBalances.get(key);
  if (!entry) displayBalances.set(key, (entry = { at: 0 }));
  const e = entry;
  const age = Date.now() - e.at;
  if (e.value && age < DISPLAY_BALANCE_FRESH_MS) return e.value;
  e.inflight ??= treasuryBalance(address)
    .then(({ eth, usd }) => {
      e.value = { eth, usd };
      e.at = Date.now();
    })
    .finally(() => {
      e.inflight = undefined;
    });
  if (e.value && age < DISPLAY_BALANCE_STALE_MS) {
    // the read behind a stale value fails on its own; the value still stands
    e.inflight.catch(() => {});
    return e.value;
  }
  await e.inflight;
  return e.value!;
}

/** What the chain says about a transaction now: mined (either way), or not seen (yet, or an RPC blip). */
export async function receiptStatus(hash: `0x${string}`): Promise<"success" | "reverted" | null> {
  try {
    const receipt = await pub.getTransactionReceipt({ hash });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return null;
  }
}

// ── moving money ────────────────────────────────────────────────────────────

// One sender's transactions go out one at a time in this process, so two
// quorums completing together cannot race each other for the same nonce.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, run);
  void run.finally(() => {
    if (queues.get(key) === run) queues.delete(key);
  }).catch(() => {});
  return run;
}

function funderAccount() {
  const raw = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
  if (!raw) throw new Error("treasury: no funder configured (set RELAYER_KEY or DEPLOYER_KEY)");
  try {
    return privateKeyToAccount(toPrivateKey(raw.trim()));
  } catch {
    throw new Error("treasury: the funder key (RELAYER_KEY ?? DEPLOYER_KEY) is malformed");
  }
}

/** The testnet funder that seeds treasuries and sponsors gas (also the demo payee). */
export function funderAddress(): `0x${string}` {
  return funderAccount().address;
}

/** Errors carry the hash when a transaction was sent, so a caller never pays twice blindly. */
function txError(message: string, txHash: Hex | null): Error {
  return Object.assign(new Error(message), { txHash });
}

async function confirmed(hash: Hex, what: string): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt;
  try {
    receipt = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch (err) {
    throw txError(
      `${what} was sent but not confirmed within ${RECEIPT_TIMEOUT_MS / 1000}s (tx ${hash}) — it may still land; check the explorer before retrying. ${err instanceof Error ? err.message.split("\n")[0] : ""}`.trim(),
      hash
    );
  }
  if (receipt.status !== "success") throw txError(`${what} reverted on Sepolia (tx ${hash})`, hash);
  return receipt;
}

async function sendFromFunder(to: `0x${string}`, value: bigint, what: string): Promise<Hex> {
  const account = funderAccount();
  return serialized(`sender:${account.address.toLowerCase()}`, async () => {
    const have = await pub.getBalance({ address: account.address });
    if (have <= value)
      throw new Error(
        `treasury: ${what} needs ${formatEther(value)} SepETH but the funder ${account.address} holds only ${formatEther(have)}`
      );
    const funder = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    const hash = await funder.sendTransaction({ to, value });
    await confirmed(hash, what);
    return hash;
  });
}

/**
 * Tops the treasury up to `targetUsd` from the funder. Returns the funding tx
 * hash, or null when it already holds at least that much.
 */
export async function fundTreasury(address: `0x${string}`, targetUsd: number): Promise<string | null> {
  const target = usdToWei(targetUsd);
  const have = await pub.getBalance({ address });
  if (have >= target) return null;
  return sendFromFunder(address, target - have, "treasury funding");
}

/**
 * Pays the treasury back what a confirmed transfer burned in gas, less what the
 * funder already sponsored up front for it — the relayer covers gas once.
 * Best effort: the payment has landed by now, so a refund that cannot be made
 * is logged and reported as null, never thrown.
 */
async function refundGas(
  treasury: `0x${string}`,
  payment: TransactionReceipt,
  sponsored: bigint
): Promise<Hex | null> {
  const price: unknown = payment.effectiveGasPrice;
  if (typeof price !== "bigint") {
    console.warn(`treasury: the receipt of ${payment.transactionHash} has no effectiveGasPrice — gas not refunded`);
    return null;
  }
  const owed = payment.gasUsed * price - sponsored;
  if (owed <= ZERO) return null;
  if (!process.env.RELAYER_KEY && !process.env.DEPLOYER_KEY) {
    console.warn(`treasury: no funder configured — the gas for ${payment.transactionHash} is not refunded`);
    return null;
  }
  try {
    return await sendFromFunder(treasury, owed, "gas refund");
  } catch (err) {
    console.error(`treasury: gas refund for ${payment.transactionHash} failed (the payment stands):`, err);
    return null;
  }
}

/**
 * Pays `amountUsd` from the agent's treasury to `to` through AgentKit's
 * native_transfer, and returns once the payment is confirmed. The principal
 * must already be in the treasury; if what is left for gas is short, the
 * funder adds only the missing gas (at most 0.0005 SepETH) first.
 *
 * Gas is the relayer's, not the relation's: once the payment is confirmed the
 * funder refunds gasUsed × effectiveGasPrice (net of any up-front sponsorship)
 * and that refund is confirmed too before returning, so the treasury's balance
 * has moved by exactly the payment when the caller records it executed.
 * `gasRefundTx` is null when no refund was due or it could not be made.
 */
export async function transferUsd(
  agentUserId: string,
  to: `0x${string}`,
  amountUsd: number
): Promise<{ txHash: `0x${string}`; gasRefundTx: `0x${string}` | null; gasSponsored: boolean }> {
  if (!isAddress(to)) throw new Error(`treasury: ${to} is not an address`);
  const valueEth = usdToEth(amountUsd);
  const value = parseEther(valueEth);
  if (value <= ZERO) throw new Error(`treasury: $${amountUsd} is not an amount that can be sent`);

  const wallet = await agentKitFor(await agentKey(agentUserId));
  const from = getAddress(wallet.address);

  return serialized(`sender:${from.toLowerCase()}`, async () => {
    const balance = await pub.getBalance({ address: from });
    if (balance < value)
      throw new Error(
        `treasury: the wallet holds ${formatEther(balance)} SepETH ($${ethToUsd(balance)}), less than $${amountUsd} (${valueEth} SepETH)`
      );

    const { maxFeePerGas } = await pub.estimateFeesPerGas();
    const gasCost = TRANSFER_GAS_UNITS * maxFeePerGas;
    const wanted = value + gasCost * TWO;
    let sponsored = ZERO;
    if (balance < wanted) {
      const sponsor = wanted - balance > GAS_SPONSOR_CAP ? GAS_SPONSOR_CAP : wanted - balance;
      if (balance + sponsor < value + gasCost)
        throw new Error(
          `treasury: Sepolia gas (${formatEther(gasCost)} SepETH for this transfer) is above what the demo sponsors right now`
        );
      await sendFromFunder(from, sponsor, "gas sponsorship");
      sponsored = sponsor;
    }

    const result = await invokeAction(wallet, "native_transfer", { to: getAddress(to), value: valueEth });
    // AgentKit reports failures as a string, not a throw — and the string can
    // carry the hash of a transaction that was sent and may still land.
    if (/^Error during /i.test(result))
      throw txError(`treasury transfer failed: ${result}`, txHashFromActionResult(result));
    const txHash = txHashFromActionResult(result);
    if (!txHash) throw new Error(`treasury transfer returned no transaction hash: ${result}`);
    const receipt = await confirmed(txHash, "treasury transfer");
    // inside this sender's queue: the next transfer's gas check sees the refund
    const gasRefundTx = await refundGas(from, receipt, sponsored);
    return { txHash, gasRefundTx, gasSponsored: sponsored > ZERO || gasRefundTx !== null };
  });
}
