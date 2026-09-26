/**
 * The Base side of the presenter's Tokyo Trip copy (seed-tokyo-trip.mts --mine): funds the demo
 * pot and a presenter wallet, and has three friends start recurring contributions into the pot
 * through Permit2 — real wallets, real USDC, each allowing exactly its plan's total. Run once: the
 * room and member ids are fixed (demo-ids.mts) and the pot is DEMO_POT_KEY's, so every server the
 * seed runs on shows these plans under the friends' names. The first collection is the app's (the
 * collect button, or a weekly run), so Treasury Activity and the chat record it.
 *
 *   cd app && FUNDER_KEY=0x… npx tsx --tsconfig scripts/tsconfig.json scripts/demo-contributions.mts
 *     FUNDER_KEY   a Base wallet with USDC and a little ETH that pays for all of it
 *
 * Each friend's wallet key is derived from DEMO_POT_KEY (app/.env.demo), so a rerun finds the same
 * wallets and skips what is already done. Nothing here prints a key.
 */
try {
  process.loadEnvFile?.(new URL("../.env.demo", import.meta.url).pathname);
} catch {
  // checked below
}

const { createPublicClient, createWalletClient, encodeFunctionData, fallback, formatEther, formatUnits, http, keccak256, parseAbi, parseEther, stringToBytes } = await import("viem");
const { privateKeyToAccount } = await import("viem/accounts");
const { base } = await import("viem/chains");
const { CONTRIBUTION_CHAIN: C, contributionAbi, contributionPlanId, contributionSalt, permit2Abi, usdcAbi } = await import(
  "../src/lib/agent/treasury/contribution-plan"
);
const { MINE_ROOM_ID, mineFriendId } = await import("./demo-ids.mts");

type Hex = `0x${string}`;
const potKey = process.env.DEMO_POT_KEY?.trim() as Hex | undefined;
const funderKey = process.env.FUNDER_KEY?.trim() as Hex | undefined;
const presenterKey = process.env.DEMO_PRESENTER_KEY?.trim() as Hex | undefined;
if (!potKey || !funderKey) throw new Error("set DEMO_POT_KEY (app/.env.demo) and FUNDER_KEY");

const WEEK = 7 * 24 * 3600;
const USDC = (n: string) => BigInt(Math.round(Number(n) * 1e6));
/** the friends' plans: $20 a week is 0.1 USDC at the demo scale ($1 = 0.005 USDC) */
const PLANS = [
  { key: "bea", amount: USDC("0.1"), period: WEEK, periods: 4 },
  { key: "chris", amount: USDC("0.1"), period: WEEK, periods: 4 },
  { key: "dana", amount: USDC("0.2"), period: 2 * WEEK, periods: 2 },
] as const;
/** what the pot keeps for the weekly buys and the agent's gas */
const POT_USDC = USDC("1");
const POT_ETH = parseEther("0.0002");
/** a friend sends three transactions; a presenter three on stage plus a stop */
const MEMBER_ETH = parseEther("0.00002");
const PRESENTER_USDC = USDC("0.4");
const PRESENTER_ETH = parseEther("0.00004");

const rpcs = [process.env.BASE_RPC_URL, "https://mainnet.base.org", "https://base.drpc.org"].filter((u): u is string => !!u && !/localhost|127\.0\.0\.1/.test(u));
const transport = fallback(rpcs.map((u) => http(u, { timeout: 15_000 })), { rank: false });
const client = createPublicClient({ chain: base, transport });

const pot = privateKeyToAccount(potKey).address;
const funder = privateKeyToAccount(funderKey);
const friendKey = (key: string) => keccak256(stringToBytes(`${potKey}:friend:${key}`));

const transferAbi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

/** One account's sends, in nonce order, each waited for. */
function sender(key: Hex) {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: base, transport });
  let nonce: number | null = null;
  return {
    address: account.address,
    async send(label: string, tx: { to: Hex; data?: Hex; value?: bigint; gas?: bigint }) {
      nonce ??= await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? BigInt(0), nonce, ...(tx.gas ? { gas: tx.gas } : {}) });
      nonce++;
      const receipt = await client.waitForTransactionReceipt({ hash });
      console.log(`  ${receipt.status === "success" ? "ok  " : "FAIL"} ${label} — ${C.explorer}/tx/${hash}`);
      if (receipt.status !== "success") throw new Error(`${label} reverted`);
    },
  };
}

const usdcOf = (who: Hex) => client.readContract({ address: C.usdc, abi: usdcAbi, functionName: "balanceOf", args: [who] });
const funding = sender(funderKey);

async function topUp(label: string, who: Hex, usdc: bigint, eth: bigint) {
  const [heldUsdc, heldEth] = await Promise.all([usdcOf(who), client.getBalance({ address: who })]);
  if (heldUsdc < usdc)
    await funding.send(`${label}: ${formatUnits(usdc - heldUsdc, 6)} USDC`, {
      to: C.usdc,
      data: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [who, usdc - heldUsdc] }),
    });
  if (heldEth < eth) await funding.send(`${label}: ${formatEther(eth - heldEth)} ETH`, { to: who, value: eth - heldEth });
  // a load-balanced RPC can answer the next call from a node a block behind: wait until this client sees the funds
  for (let i = 0; i < 20; i++) {
    const [u, e] = await Promise.all([usdcOf(who), client.getBalance({ address: who })]);
    if (u >= usdc && e >= eth) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`${label}: the funds are not visible on this RPC yet — run again in a minute`);
}

console.log(`funder ${funder.address} · pot ${pot} · room ${MINE_ROOM_ID}`);
await topUp("pot", pot, POT_USDC, POT_ETH);
if (presenterKey) await topUp("presenter", privateKeyToAccount(presenterKey).address, PRESENTER_USDC, PRESENTER_ETH);

const [ids] = await client.readContract({ address: C.contract, abi: contributionAbi, functionName: "plansOf", args: [pot] });
const now = Number((await client.getBlock()).timestamp);
for (const p of PLANS) {
  const member = sender(friendKey(p.key));
  const salt = contributionSalt(MINE_ROOM_ID, mineFriendId(p.key));
  const id = contributionPlanId(member.address, pot, C.usdc, salt);
  if (ids.includes(id)) {
    console.log(`${p.key}: plan ${id.slice(0, 10)}… already started`);
    continue;
  }
  const total = p.amount * BigInt(p.periods);
  // a minute short of the last period's end, so the plan has exactly `periods` periods
  const until = now + p.periods * p.period - 60;
  console.log(`${p.key} ${member.address}: ${formatUnits(p.amount, 6)} USDC every ${p.period / 86400} days × ${p.periods}, allowing exactly ${formatUnits(total, 6)}`);
  await topUp(p.key, member.address, total, MEMBER_ETH);
  await member.send(`${p.key}: USDC.approve(Permit2, ${formatUnits(total, 6)})`, {
    to: C.usdc,
    data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [C.permit2, total] }),
    gas: BigInt(80_000),
  });
  await member.send(`${p.key}: Permit2.approve(USDC, contract, ${formatUnits(total, 6)}, until)`, {
    to: C.permit2,
    data: encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [C.usdc, C.contract, total, until] }),
    gas: BigInt(100_000),
  });
  await member.send(`${p.key}: start`, {
    to: C.contract,
    data: encodeFunctionData({ abi: contributionAbi, functionName: "start", args: [pot, C.usdc, p.amount, p.period, until, salt] }),
    gas: BigInt(260_000),
  });
}

const [after] = await client.readContract({ address: C.contract, abi: contributionAbi, functionName: "plansOf", args: [pot] });
console.log(`plansOf(pot): ${after.length} plan(s) · pot USDC ${formatUnits(await usdcOf(pot), 6)} · funder USDC ${formatUnits(await usdcOf(funder.address), 6)}`);
