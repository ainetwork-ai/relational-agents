// ens/scripts/simulate-check.ts
// Runs the real issue.ts flows against Sepolia with a sender that broadcasts NOTHING: every write is
// recorded, then the recorded sequence is replayed with eth_simulateV1 (viem simulateBlocks), one
// simulated block per wait, so a call that depends on an earlier one (register after deploy, register
// after commit + MIN_COMMITMENT_AGE) sees its effects. No key is loaded; the accounts are addresses.
//
//   cd ens && npm run simulate
import { createPublicClient, decodeEventLog, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { ethRegistrarAbi, registryAbi } from "../src/abi";
import { ethExpiry } from "../src/availability";
import { YEAR_SECONDS } from "../src/config";
import {
  addMember,
  deployFamilyContracts,
  NameTakenError,
  predictRegistry,
  predictResolver,
  registerEthName,
  renewEthName,
  type IssueContext,
  type Sender,
  type TxStep,
  type WriteRequest,
} from "../src/issue";

const rpcUrl = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const DEPLOYER: Address = "0xF99B8c866A3d19678bAe7b2600dDb7A2d047Dc7b";
const GRANDMA: Address = "0x7276c558b242e813825Fb7208E0dc7301E62091A";
const KIM_REGISTRY: Address = "0x10537c5d48b0a8f2B8eAfc6D0094d6bcAaF2484B"; // holds grandma
const FAMILY = "kim.ainmem.eth";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) fails++;
};

/** Records writes instead of sending them; each waitUntil starts a new simulated block at that time. */
function recorder() {
  const blocks: { time?: number; calls: WriteRequest[] }[] = [{ calls: [] }];
  const sender: Sender = {
    async send(req) {
      blocks[blocks.length - 1].calls.push(req);
      return null;
    },
    async waitUntil(t) {
      // t counts from wall-clock "now" (nothing was mined); the first simulated block sits at about
      // latest + 12 s, so the next one gets a margin to stay past MIN_COMMITMENT_AGE
      blocks.push({ time: t + 15, calls: [] });
    },
  };
  const calls = () => blocks.flatMap((b) => b.calls);
  /** noWait: drop the time jumps (a negative control — register must then fail as too new). */
  async function replay(account: Address, opts: { noWait?: boolean } = {}) {
    const nonEmpty = opts.noWait ? [{ calls: calls() } as { time?: number; calls: WriteRequest[] }] : blocks.filter((b) => b.calls.length);
    const res = await pub.simulateBlocks({
      blocks: nonEmpty.map((b) => ({
        ...(b.time ? { blockOverrides: { time: BigInt(b.time) } } : {}),
        calls: b.calls.map((c) => ({ account, to: c.address, abi: c.abi, functionName: c.functionName, args: c.args })),
      })),
    } as unknown as Parameters<typeof pub.simulateBlocks>[0]);
    return res.flatMap((b, i) => b.calls.map((r, j) => ({ req: nonEmpty[i].calls[j], ...r })));
  }
  return { sender, calls, replay };
}

const steps: TxStep[] = [];
const ctxFor = (account: Address, sender: Sender): IssueContext => ({ pub, account, sender, onStep: (s) => steps.push(s) });
const nonces = async () => Promise.all([DEPLOYER, GRANDMA].map((a) => pub.getTransactionCount({ address: a })));
const before = await nonces();

// (a) a fresh, account-salted family from the deployer: deploy registry + resolver, then the .eth registration
{
  const label = `zz-sim-${Date.now()}`;
  const rec = recorder();
  const ctx = ctxFor(DEPLOYER, rec.sender);
  const fam = await deployFamilyContracts(ctx, { familyLabel: label, familyAlias: "Sim family" });
  ok("(a) family registry/resolver at the account-salted CREATE2 addresses",
    fam.registry === predictRegistry(ctx, `${label}.eth`) && fam.resolver === predictResolver(ctx, `${label}.eth`) && fam.fromBlock === null);
  await registerEthName(ctx, { label, registry: fam.registry, resolver: fam.resolver, onSave: () => {} });
  const results = await rec.replay(DEPLOYER);
  const names = results.map((r) => `${r.req.functionName}:${r.status}`);
  ok("(a) deploy ×2, [mint], [approve], commit, register — all simulate OK", results.every((r) => r.status === "success") && names.includes("commit:success") && names.includes("register:success"), names.join(" "));
  ok("(a) the simulated deploys return the predicted addresses",
    results.filter((r) => r.req.functionName === "deployProxy").map((r) => r.result as Address).join() === [fam.registry, fam.resolver].join());
  const noWait = await rec.replay(DEPLOYER, { noWait: true });
  ok("(a) negative control: without the wait, register fails (CommitmentTooNew)", noWait[noWait.length - 1].status === "failure", noWait.map((r) => r.status).join());
  ok("(a) steps have stable keys, a waiting step, nothing broadcast", steps.some((s) => s.key === `eth:${label}:wait` && s.status === "waiting") && steps.every((s) => s.hash === null));
}

// (b) addMember under grandma from the deployer: grandma already has a subregistry → 2 txs (resolver + register)
{
  steps.length = 0;
  const rec = recorder();
  const ctx = ctxFor(DEPLOYER, rec.sender);
  const grandmaName = `grandma.${FAMILY}`;
  const grandmaSub = await pub.readContract({ address: KIM_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: ["grandma"] });
  const label = `aunt-${Date.now()}`;
  const someone: Address = "0x00000000000000000000000000000000000a11ce";
  const { registry } = await addMember(ctx, {
    parentName: grandmaName, parentRegistry: KIM_REGISTRY, parentLabel: "grandma", label, alias: "Aunt", relation: "daughter", address: someone,
    treeAddresses: [GRANDMA],
  });
  ok("(b) returns grandma's existing subregistry", registry === grandmaSub, registry);
  const fns = rec.calls().map((c) => c.functionName);
  ok("(b) 2 txs: deployProxy (resolver), register", fns.join() === "deployProxy,register", fns.join());
  const results = await rec.replay(DEPLOYER);
  const resolver = predictResolver(ctx, `${label}.${grandmaName}`);
  ok("(b) both simulate OK in sequence", results.every((r) => r.status === "success"), results.map((r) => r.status).join());
  ok("(b) the resolver deploy lands at the predicted address", results[0]?.result === resolver, resolver);
  // register alone needs nothing deployed: the registry stores the resolver address without calling it
  const reg = rec.calls()[1];
  const alone = await pub.simulateContract({ account: DEPLOYER, address: reg.address, abi: registryAbi, functionName: "register", args: reg.args as never });
  ok("(b) register with the predicted (not yet deployed) resolver simulates alone", alone.result > BigInt(0));
  ok("(b) skipped rows for the subregistry steps", steps.filter((s) => s.status === "skipped").map((s) => s.key.split(":")[0]).join() === "deploy-registry,set-subregistry");
}

// (b') addMember under minjun (a leaf: no subregistry yet) from the deployer → 4 txs
{
  steps.length = 0;
  const rec = recorder();
  const ctx = ctxFor(DEPLOYER, rec.sender);
  const grandmaSub = await pub.readContract({ address: KIM_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: ["grandma"] });
  const dadSub = await pub.readContract({ address: grandmaSub, abi: registryAbi, functionName: "getSubregistry", args: ["dad"] });
  const minjun = `minjun.dad.grandma.${FAMILY}`;
  const { registry } = await addMember(ctx, {
    parentName: minjun, parentRegistry: dadSub, parentLabel: "minjun", label: `kid-${Date.now()}`, alias: "Kid", relation: "son",
    address: "0x00000000000000000000000000000000000c0c00", treeAddresses: [],
  });
  const fns = rec.calls().map((c) => c.functionName);
  ok("(b') 4 txs: deployProxy (registry), setSubregistry, deployProxy (resolver), register", fns.join() === "deployProxy,setSubregistry,deployProxy,register", fns.join());
  ok("(b') the new subregistry is the predicted one", registry === predictRegistry(ctx, minjun), registry);
  const results = await rec.replay(DEPLOYER);
  ok("(b') all 4 simulate OK in sequence", results.every((r) => r.status === "success"), results.map((r) => r.status).join());
}

// (c) minjun under dad from grandma's address → NameTakenError, nothing recorded (never adopts)
{
  const rec = recorder();
  const dadSub = await pub.readContract({ address: await pub.readContract({ address: KIM_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: ["grandma"] }), abi: registryAbi, functionName: "getSubregistry", args: ["dad"] });
  let err: unknown = null;
  try {
    await addMember(ctxFor(GRANDMA, rec.sender), {
      parentName: `dad.grandma.${FAMILY}`, parentRegistry: await pub.readContract({ address: KIM_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: ["grandma"] }),
      parentLabel: "dad", label: "minjun", alias: "Minjun", relation: "son", address: "0x00000000000000000000000000000000000b0b00", treeAddresses: [],
    });
  } catch (e) {
    err = e;
  }
  ok("(c) minjun under dad from grandma → NameTakenError", err instanceof NameTakenError && err.name === `minjun.dad.grandma.${FAMILY}`, String(err));
  ok("(c) no write was even recorded", rec.calls().length === 0 && dadSub !== "0x0000000000000000000000000000000000000000");
}

// (d) renew ainmem.eth for a year from grandma's wallet: anyone may renew (F3)
{
  const rec = recorder();
  const exp = await ethExpiry(pub, "ainmem");
  const { newExpiry } = await renewEthName(ctxFor(GRANDMA, rec.sender), { label: "ainmem", years: 1 });
  ok("(d) price + renewable reads passed; expected expiry moves by one year", !!exp && newExpiry === BigInt(exp.expiresAt) + YEAR_SECONDS, `${exp?.expiresAt} → ${newExpiry}`);
  const results = await rec.replay(GRANDMA);
  const fns = results.map((r) => `${r.req.functionName}:${r.status}`);
  ok("(d) [mint], [approve], renew from grandma simulate OK", results.every((r) => r.status === "success") && fns[fns.length - 1] === "renew:success", fns.join(" "));
  const renewed = results[results.length - 1].logs?.map((l) => { try { return decodeEventLog({ abi: ethRegistrarAbi, ...l }); } catch { return null; } }).find((e) => e?.eventName === "NameRenewed");
  ok("(d) the simulated NameRenewed carries the same newExpiry", !!renewed && renewed.eventName === "NameRenewed" && renewed.args.newExpiry === newExpiry);
}

const after = await nonces();
ok("no transaction was broadcast (deployer and grandma nonces unchanged)", before.join() === after.join(), `${before} → ${after}`);
process.exit(fails ? 1 : 0);
