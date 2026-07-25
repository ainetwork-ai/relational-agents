// One-time: register the wrapped parent name (default relagent.eth) on
// Sepolia ENS, so the app relayer can mint agent subnames under it.
//
//   DEPLOYER_KEY=0x... [PARENT_LABEL=relagent] node ens/register-parent.mjs
//
// Uses the ETHRegistrarController commit/reveal flow (60s wait between the
// two transactions). The registrant is the relayer account, names are
// wrapped by default (controller v2), resolver = PublicResolver.
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const LABEL = process.env.PARENT_LABEL ?? "relagent";
const DURATION = BigInt(365 * 24 * 3600); // 1 year
// Sepolia ENS deployments (override via env if they rotate)
const CONTROLLER = process.env.ENS_CONTROLLER ?? "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72";
const RESOLVER = process.env.ENS_PUBLIC_RESOLVER ?? "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD";

const ABI = [
  { type: "function", name: "available", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "rentPrice", stateMutability: "view", inputs: [{ name: "name", type: "string" }, { name: "duration", type: "uint256" }], outputs: [{ name: "price", type: "tuple", components: [{ name: "base", type: "uint256" }, { name: "premium", type: "uint256" }] }] },
  { type: "function", name: "makeCommitment", stateMutability: "pure", inputs: [
    { name: "name", type: "string" }, { name: "owner", type: "address" }, { name: "duration", type: "uint256" }, { name: "secret", type: "bytes32" },
    { name: "resolver", type: "address" }, { name: "data", type: "bytes[]" }, { name: "reverseRecord", type: "bool" }, { name: "ownerControlledFuses", type: "uint16" },
  ], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [{ name: "commitment", type: "bytes32" }], outputs: [] },
  { type: "function", name: "register", stateMutability: "payable", inputs: [
    { name: "name", type: "string" }, { name: "owner", type: "address" }, { name: "duration", type: "uint256" }, { name: "secret", type: "bytes32" },
    { name: "resolver", type: "address" }, { name: "data", type: "bytes[]" }, { name: "reverseRecord", type: "bool" }, { name: "ownerControlledFuses", type: "uint16" },
  ], outputs: [] },
];

const key = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
if (!key) throw new Error("Set RELAYER_KEY or DEPLOYER_KEY");
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const available = await pub.readContract({ address: CONTROLLER, abi: ABI, functionName: "available", args: [LABEL] });
if (!available) {
  console.log(`${LABEL}.eth is not available (maybe already ours) — nothing to do`);
  process.exit(0);
}

const secret = toHex(randomBytes(32));
const args = [LABEL, account.address, DURATION, secret, RESOLVER, [], false, 0];
const commitment = await pub.readContract({ address: CONTROLLER, abi: ABI, functionName: "makeCommitment", args });

console.log(`committing for ${LABEL}.eth as ${account.address}…`);
const c = await wallet.writeContract({ address: CONTROLLER, abi: ABI, functionName: "commit", args: [commitment] });
await pub.waitForTransactionReceipt({ hash: c });
console.log("commit landed — waiting 70s for the reveal window…");
await new Promise((r) => setTimeout(r, 70_000));

const { base, premium } = await pub.readContract({ address: CONTROLLER, abi: ABI, functionName: "rentPrice", args: [LABEL, DURATION] });
const value = ((base + premium) * BigInt(105)) / BigInt(100); // 5% headroom, excess refunds
console.log(`registering (${value} wei)…`);
const r = await wallet.writeContract({ address: CONTROLLER, abi: ABI, functionName: "register", args, value });
const rec = await pub.waitForTransactionReceipt({ hash: r });
console.log(`done: ${LABEL}.eth → ${account.address} (${rec.status}) tx ${r}`);
console.log(`\nAdd to app/.env.local:\n  ENS_PARENT_NAME=${LABEL}.eth\n  ENS_NAMEWRAPPER=0x0635513f179D50A207757E05759CbD106d7dFcE8\n  ENS_PUBLIC_RESOLVER=${RESOLVER}`);
