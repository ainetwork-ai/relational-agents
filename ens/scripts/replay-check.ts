// ens/scripts/replay-check.ts
// Proves a transaction request the app handed to a wallet is the right one, without sending anything
// (plan 2026-09-26-ens-family-settings, Task 7b): the recorded eth_sendTransaction is replayed as an
// eth_call against Sepolia, then the same add is rebuilt with addMember and a recording sender — its
// first call must be byte-identical to the recorded one — and the whole sequence (resolver deploy, then
// register in the parent's subregistry with the predicted resolver) is simulated with eth_simulateV1.
// Read/simulate only; no key is loaded.
//
//   npx tsx scripts/replay-check.ts <recorded.json> <parentName> <parentRegistry> <parentLabel> <label> <alias> <relation> <address>
//   recorded.json: [{ from, to, data, value }] as captured by the recording EIP-1193 provider
import fs from "node:fs";
import { createPublicClient, decodeFunctionData, encodeFunctionData, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { factoryAbi, registryAbi } from "../src/abi";
import { addMember, predictResolver, type Sender, type WriteRequest } from "../src/issue";
import type { Relation } from "../src/config";

const [file, parentName, parentRegistry, parentLabel, label, alias, relation, address] = process.argv.slice(2);
if (!address) {
  console.error("usage: replay-check.ts <recorded.json> <parentName> <parentRegistry> <parentLabel> <label> <alias> <relation> <address>");
  process.exit(2);
}
const pub = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com") });
const recorded = JSON.parse(fs.readFileSync(file, "utf8")) as { from: Address; to: Address; data: Hex; value: Hex | null }[];
const tx = recorded[0];
let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) fails++;
};

const nonceBefore = await pub.getTransactionCount({ address: tx.from });

// 1. the recorded request itself, as an eth_call
const call = await pub.call({ account: tx.from, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined });
const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data });
const name = `${label}.${parentName}`;
const predicted = predictResolver({ account: tx.from }, name);
ok("recorded eth_sendTransaction replayed as eth_call succeeds", !!call.data, `returns ${call.data?.slice(0, 66)}`);
ok("it is VerifiableFactory.deployProxy (selector 0x5d84121a)", decoded.functionName === "deployProxy" && tx.data.startsWith("0x5d84121a"));
ok("the call would deploy the resolver at the predicted CREATE2 address", !!call.data && `0x${call.data.slice(26, 66)}`.toLowerCase() === predicted.toLowerCase(), predicted);

// 2. the same add rebuilt with issue.ts: the first write must be exactly what the browser sent
const writes: WriteRequest[] = [];
const sender: Sender = {
  async send(req) {
    writes.push(req);
    return null;
  },
  async waitUntil() {},
};
await addMember(
  { pub: pub as never, account: tx.from, sender },
  { parentName, parentRegistry: parentRegistry as Address, parentLabel, label, alias, relation: relation as Relation, address: address as Address, treeAddresses: [] }
);
const encoded = writes.map((w) => encodeFunctionData({ abi: w.abi, functionName: w.functionName, args: w.args } as never) as Hex);
ok("addMember rebuilds 2 writes: deployProxy, register", writes.map((w) => w.functionName).join() === "deployProxy,register", writes.map((w) => w.functionName).join());
ok("the rebuilt first write is byte-identical to the recorded data", encoded[0] === tx.data && writes[0].address.toLowerCase() === tx.to.toLowerCase());
const reg = writes[1];
const regArgs = reg.args as readonly unknown[];
const sub = await pub.readContract({ address: parentRegistry as Address, abi: registryAbi, functionName: "getSubregistry", args: [parentLabel] });
ok("register goes to the parent's subregistry with the predicted resolver", reg.address.toLowerCase() === sub.toLowerCase() && String(regArgs[3]).toLowerCase() === predicted.toLowerCase() && regArgs[0] === label, `${reg.address} · resolver ${regArgs[3]}`);

// 3. the sequence: register as an eth_call on its own, then both in one simulated block
const regCall = await pub.call({ account: tx.from, to: reg.address, data: encoded[1] });
ok("register (second call) as eth_call succeeds", !!regCall.data, `tokenId ${regCall.data?.slice(0, 18)}…`);
const sim = await pub.simulateBlocks({
  blocks: [{ calls: [{ account: tx.from, to: tx.to, data: tx.data }, { account: tx.from, to: reg.address, data: encoded[1] }] }],
} as never);
const statuses = (sim as unknown as { calls: { status: string }[] }[])[0].calls.map((c) => c.status);
ok("deployProxy then register simulate OK in sequence (eth_simulateV1)", statuses.join() === "success,success", statuses.join());

const nonceAfter = await pub.getTransactionCount({ address: tx.from });
ok("nothing was sent (nonce unchanged)", nonceBefore === nonceAfter, `${nonceBefore} → ${nonceAfter}`);
console.log(`\n${fails ? `${fails} failed` : "all passed"}`);
process.exit(fails ? 1 : 0);
