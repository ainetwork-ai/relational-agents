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
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { unseal } from "@/lib/secret-box";
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

function keyFromStored(stored: string, agentUserId: string): Hex {
  if (stored.startsWith(FAMILY_WALLET_PREFIX)) {
    const [, address, sealed] = stored.split(":");
    const plain = sealed ? unseal(FAMILY_WALLET_LABEL, sealed) : null;
    try {
      const key = toPrivateKey(plain ?? "");
      if (isAddress(address) && privateKeyToAccount(key).address === getAddress(address)) return key;
    } catch {
      // falls through to the error below
    }
    throw new Error(
      `treasury: agent ${agentUserId} holds a family-wallet (fw1) key this server cannot unseal — check SESSION_SECRET. The stored key was left untouched.`
    );
  }
  try {
    return toPrivateKey(stored);
  } catch {
    throw new Error(
      `treasury: agent ${agentUserId} has a stored key that is neither 64-hex nor fw1 — refusing to replace it.`
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
 * The agent's private key, minted on first use. Agents are born keyless
 * (provision.ts), and a key that already exists — legacy hex or a gift.ts
 * fw1 key — is never overwritten: the write is conditional on the column
 * being empty, so two concurrent first calls end up with the same key.
 */
async function agentKey(agentUserId: string): Promise<Hex> {
  let stored = await storedKeyOf(agentUserId);
  if (!stored) {
    await db
      .update(users)
      .set({ encryptedPrivateKey: generatePrivateKey() })
      .where(
        and(
          eq(users.id, agentUserId),
          or(isNull(users.encryptedPrivateKey), eq(users.encryptedPrivateKey, ""))
        )
      );
    stored = await storedKeyOf(agentUserId);
    if (!stored) throw new Error(`treasury: could not store a wallet key for agent ${agentUserId}`);
  }
  return keyFromStored(stored, agentUserId);
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

async function confirmed(hash: Hex, what: string): Promise<void> {
  let status: "success" | "reverted";
  try {
    ({ status } = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS }));
  } catch (err) {
    throw txError(
      `${what} was sent but not confirmed within ${RECEIPT_TIMEOUT_MS / 1000}s (tx ${hash}) — it may still land; check the explorer before retrying. ${err instanceof Error ? err.message.split("\n")[0] : ""}`.trim(),
      hash
    );
  }
  if (status !== "success") throw txError(`${what} reverted on Sepolia (tx ${hash})`, hash);
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
 * Pays `amountUsd` from the agent's treasury to `to` through AgentKit's
 * native_transfer, and returns once the payment is confirmed. The principal
 * must already be in the treasury; if what is left for gas is short, the
 * funder adds only the missing gas (at most 0.0005 SepETH).
 */
export async function transferUsd(
  agentUserId: string,
  to: `0x${string}`,
  amountUsd: number
): Promise<{ txHash: `0x${string}` }> {
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
    if (balance < wanted) {
      const sponsor = wanted - balance > GAS_SPONSOR_CAP ? GAS_SPONSOR_CAP : wanted - balance;
      if (balance + sponsor < value + gasCost)
        throw new Error(
          `treasury: Sepolia gas (${formatEther(gasCost)} SepETH for this transfer) is above what the demo sponsors right now`
        );
      await sendFromFunder(from, sponsor, "gas sponsorship");
    }

    const result = await invokeAction(wallet, "native_transfer", { to: getAddress(to), value: valueEth });
    // AgentKit reports failures as a string, not a throw — and the string can
    // carry the hash of a transaction that was sent and may still land.
    if (/^Error during /i.test(result))
      throw txError(`treasury transfer failed: ${result}`, txHashFromActionResult(result));
    const txHash = txHashFromActionResult(result);
    if (!txHash) throw new Error(`treasury transfer returned no transaction hash: ${result}`);
    await confirmed(txHash, "treasury transfer");
    return { txHash };
  });
}
