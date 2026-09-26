// ens/scripts/live-check.ts
// Reads the real demo family from Sepolia and checks what needs no wallet.
//
//   cd ens && ENS_FAMILY_ROOT=kim.ainmem.eth ENS_FAMILY_FROM_BLOCK=… GRANDMA=0x… npm run live
import { createFamilyChain } from "../src/chain";
import { displayName, type FamilyNode } from "../src/family-tree";
import { prepareSend } from "../src/prepare";

const root = process.env.ENS_FAMILY_ROOT;
if (!root) throw new Error("ENS_FAMILY_ROOT is required");
const chain = createFamilyChain({ root, rpcUrl: process.env.SEPOLIA_RPC, fromBlock: BigInt(process.env.ENS_FAMILY_FROM_BLOCK ?? "0") });

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) fails++;
};
const print = (n: FamilyNode, d = 0): void => {
  console.log(`${"  ".repeat(d)}${n.name}  alias=${n.alias} relation=${n.relation} addr=${n.address}`);
  n.children.forEach((c) => print(c, d + 1));
};

const tree = await chain.loadTree();
print(tree);
const grandma = process.env.GRANDMA ?? "";
const r = await prepareSend({ text: "send Minjun 20 USDC", askerAddress: grandma, tree }, chain);
ok("Minjun is ready to receive", r.kind === "ready" && displayName(r.recipient) === "Minjun", r.kind === "ready" ? r.recipient.name : JSON.stringify(r));
if (r.kind === "ready") ok("address matches the tree", r.to === r.recipient.address, r.to);
const ask = await prepareSend({ text: "send my grandchild 5 USDC", askerAddress: grandma, tree }, chain);
ok("two grandchildren → ask", ask.kind === "ask" && ask.candidates.length === 2);
process.exit(fails ? 1 : 0);
