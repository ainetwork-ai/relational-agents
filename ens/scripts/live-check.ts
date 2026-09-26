// ens/scripts/live-check.ts
// Reads the real demo family from Sepolia and checks what needs no wallet. Read-only: nothing is sent.
//
//   cd ens && npm run live          (defaults: the kim demo family; env overrides below)
//   ENS_FAMILY_ROOT=kim.ainmem.eth ENS_FAMILY_FROM_BLOCK=… GRANDMA=0x… SEPOLIA_RPC=… npm run live
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { ethRegistrarAbi } from "../src/abi";
import { availableSuggestions, ethExpiry, ethNameStatus, holdsAllRoles, subnameStatus } from "../src/availability";
import { createFamilyChain } from "../src/chain";
import { ETH_REGISTRAR, MOCK_USDC, YEAR_SECONDS } from "../src/config";
import { displayName, type FamilyNode } from "../src/family-tree";
import { prepareSend } from "../src/prepare";

// The kim demo family issued by setup-family.ts (block 11785247, deployer 0xF99B…Dc7b).
const root = process.env.ENS_FAMILY_ROOT ?? "kim.ainmem.eth";
const rpcUrl = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const chain = createFamilyChain({ root, rpcUrl, fromBlock: BigInt(process.env.ENS_FAMILY_FROM_BLOCK ?? "11785247") });

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
const grandma = process.env.GRANDMA ?? "0x7276c558b242e813825Fb7208E0dc7301E62091A";
const r = await prepareSend({ text: "send Minjun 20 USDC", askerAddress: grandma, tree }, chain);
ok("Minjun is ready to receive", r.kind === "ready" && displayName(r.recipient) === "Minjun", r.kind === "ready" ? r.recipient.name : JSON.stringify(r));
if (r.kind === "ready") ok("address matches the tree", r.to === r.recipient.address, r.to);
const ask = await prepareSend({ text: "send my grandchild 5 USDC", askerAddress: grandma, tree }, chain);
ok("two grandchildren → ask", ask.kind === "ask" && ask.candidates.length === 2);

// ── availability (plan task 2, F11–F15) — every call below is a read ─────────────────────────────
const pub = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
const DEPLOYER: Address = "0xF99B8c866A3d19678bAe7b2600dDb7A2d047Dc7b"; // owns ainmem.eth and every kim registry
const KIM_REGISTRY: Address = "0x10537c5d48b0a8f2B8eAfc6D0094d6bcAaF2484B"; // subregistry of kim.ainmem.eth
const KIM_RESOLVER: Address = "0x676734463e3912187bF4577A443f2B5F16DCBD50";
const AINMEM_REGISTRY: Address = "0xC1dD0CdfE33Db4E273903bdED80FB2689C31D0E2";
const DAD_REGISTRY: Address = "0x32ef6bDD58650cA20bE0B404C85DBb3C4372a5BA";
const DAD = "dad.grandma.kim.ainmem.eth";
const fresh = `zz-${Date.now()}`;

ok("ainmem.eth is taken (no wallet)", (await ethNameStatus(pub, "ainmem")).status === "taken");
ok("ainmem.eth is ours from the deployer", (await ethNameStatus(pub, "ainmem", DEPLOYER)).status === "ours");
ok("ainmem.eth is ours only with its own subregistry", (await ethNameStatus(pub, "ainmem", DEPLOYER, AINMEM_REGISTRY)).status === "ours"
  && (await ethNameStatus(pub, "ainmem", DEPLOYER, KIM_REGISTRY)).status === "taken");
ok("ainmem.eth is taken from grandma's wallet — never adopted (F13)", (await ethNameStatus(pub, "ainmem", grandma as Address)).status === "taken");
const free = await ethNameStatus(pub, fresh);
ok(`${fresh}.eth is free with a price`, free.status === "free" && !!free.price && free.price.base > BigInt(0), free.price ? `base ${free.price.base}, premium ${free.price.premium}` : "no price");
// registered outside this project: skip.eth by 0x8d4a…68B6; vitalik.eth reserved for the v1 migration
ok("skip.eth (someone else's) is taken", (await ethNameStatus(pub, "skip", DEPLOYER)).status === "taken");
ok("vitalik.eth (reserved) is taken", (await ethNameStatus(pub, "vitalik", DEPLOYER)).status === "taken");

ok("kim under ainmem.eth is taken", (await subnameStatus(pub, { parentName: "ainmem.eth", parentRegistry: AINMEM_REGISTRY, label: "kim" })) === "taken");
ok("kim under ainmem.eth is ours with the kim resolver", (await subnameStatus(pub, { parentName: "ainmem.eth", parentRegistry: AINMEM_REGISTRY, label: "kim", expectResolver: KIM_RESOLVER })) === "ours");
ok("kim is ours with the deployer as owner", (await subnameStatus(pub, { parentName: "ainmem.eth", parentRegistry: AINMEM_REGISTRY, label: "kim", expectOwner: DEPLOYER })) === "ours");
ok("kim is taken for grandma as owner", (await subnameStatus(pub, { parentName: "ainmem.eth", parentRegistry: AINMEM_REGISTRY, label: "kim", expectOwner: grandma as Address })) === "taken");
ok("minjun under dad is taken", (await subnameStatus(pub, { parentName: DAD, parentRegistry: DAD_REGISTRY, label: "minjun" })) === "taken");
ok(`${fresh} under dad is free`, (await subnameStatus(pub, { parentName: DAD, parentRegistry: DAD_REGISTRY, label: fresh })) === "free");

ok("deployer holds all roles on the kim registry", await holdsAllRoles(pub, KIM_REGISTRY, DEPLOYER));
ok("grandma does not", !(await holdsAllRoles(pub, KIM_REGISTRY, grandma as Address)));

const sugg = await availableSuggestions(pub, "ainmem", 3);
const suggFree = await Promise.all(sugg.map(async (l) => (await ethNameStatus(pub, l)).status === "free"));
ok("3 suggestions for ainmem, each free", sugg.length === 3 && suggFree.every(Boolean), sugg.join(", "));

const exp = await ethExpiry(pub, "ainmem");
const now = Date.now() / 1000;
ok("ainmem.eth expires about a year out, not in grace", !!exp && !exp.inGrace && exp.expiresAt > now && exp.expiresAt < now + 2 * 365 * 86400,
  exp ? new Date(exp.expiresAt * 1000).toISOString().slice(0, 10) : "null");
ok("ainmem.eth is renewable", await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "isRenewable", args: ["ainmem"] }));
const renew = await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "getRenewPrice", args: ["ainmem", YEAR_SECONDS, MOCK_USDC] });
ok("renewing ainmem.eth for a year has a price", renew > BigInt(0), `${renew}`);
const [minAge, maxAge] = await Promise.all([
  pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" }),
  pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "MAX_COMMITMENT_AGE" }),
]);
ok("commitment ages read", minAge > BigInt(0) && maxAge > minAge, `min ${minAge}s, max ${maxAge}s`);
ok("an unknown commitment has no time", (await pub.readContract({ address: ETH_REGISTRAR, abi: ethRegistrarAbi, functionName: "commitmentAt", args: [`0x${"ab".repeat(32)}`] })) === BigInt(0));

process.exit(fails ? 1 : 0);
