// One-time: register the parent name (default ainetwork.eth) on Sepolia ENS,
// so the app relayer can mint agent subnames under it.
//
//   DEPLOYER_KEY=0x... [PARENT_LABEL=ainetwork] node ens/register-parent.mjs
//
// Sepolia's live test controller (0xdf60…7078, found from successful on-chain
// registrations) registers instantly: no commit/reveal, no fee. The canonical
// controllers listed in ens-contracts deployments are currently NOT authorized
// on the Sepolia BaseRegistrar — every register through them reverts.
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const LABEL = process.env.PARENT_LABEL ?? "ainetwork";
const DURATION = BigInt(365 * 24 * 3600); // 1 year
const CONTROLLER = process.env.ENS_CONTROLLER ?? "0xdf60C561Ca35AD3C89D24BbA854654b1c3477078";
const RESOLVER = process.env.ENS_PUBLIC_RESOLVER ?? "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const T = {
  name: "registration",
  type: "tuple",
  components: [
    { name: "label", type: "string" },
    { name: "owner", type: "address" },
    { name: "duration", type: "uint256" },
    { name: "secret", type: "bytes32" },
    { name: "resolver", type: "address" },
    { name: "data", type: "bytes[]" },
    { name: "reverseRecord", type: "uint8" },
    { name: "referrer", type: "bytes32" },
  ],
};
const ABI = [{ type: "function", name: "register", stateMutability: "payable", inputs: [T], outputs: [] }];

const key = process.env.RELAYER_KEY ?? process.env.DEPLOYER_KEY;
if (!key) throw new Error("Set RELAYER_KEY or DEPLOYER_KEY");
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const registration = {
  label: LABEL,
  owner: account.address,
  duration: DURATION,
  secret: `0x${"0".repeat(64)}`,
  resolver: RESOLVER,
  data: [],
  reverseRecord: 0,
  referrer: `0x${"0".repeat(64)}`,
};
await pub.simulateContract({ address: CONTROLLER, abi: ABI, functionName: "register", args: [registration], value: 0n, account: account.address });
const r = await wallet.writeContract({ address: CONTROLLER, abi: ABI, functionName: "register", args: [registration], value: 0n });
const rec = await pub.waitForTransactionReceipt({ hash: r });
console.log(`done: ${LABEL}.eth → ${account.address} (${rec.status}) tx ${r}`);
console.log(`\nAdd to app/.env.local:\n  ENS_PARENT_NAME=${LABEL}.eth\n  ENS_PUBLIC_RESOLVER=${RESOLVER}`);
