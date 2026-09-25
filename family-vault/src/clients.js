import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, defineChain,
  encodeAbiParameters, keccak256, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RPC, CHAIN_ID, USDC, WETH, PARENT_PK, CHILD_PK, MARKET_PK } from "./config.js";

export const base = defineChain({
  id: CHAIN_ID,
  name: "base-fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
const wallet = (pk) =>
  createWalletClient({ account: privateKeyToAccount(pk), chain: base, transport: http(RPC) });

export const parent = wallet(PARENT_PK);
export const child = wallet(CHILD_PK);
export const market = wallet(MARKET_PK);

export const erc20Abi = parseAbi([
  "function approve(address, uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function deposit() payable",
]);

/** Read a forge artifact (abi + creation bytecode). */
export function artifact(name) {
  const j = JSON.parse(
    readFileSync(new URL(`../out/${name}.sol/${name}.json`, import.meta.url), "utf8")
  );
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** Mint USDC on the fork by writing FiatToken's balance slot (slot 9). */
export async function dealUSDC(address, amount6) {
  const slot = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, 9n])
  );
  await rpc("anvil_setStorageAt", [
    USDC, slot, `0x${amount6.toString(16).padStart(64, "0")}`,
  ]);
}

export async function dealETH(address, wei) {
  await rpc("anvil_setBalance", [address, `0x${wei.toString(16)}`]);
}

export async function dealWETH(walletClient, wei) {
  await dealETH(walletClient.account.address, wei + 10n ** 18n);
  const hash = await walletClient.writeContract({
    address: WETH, abi: erc20Abi, functionName: "deposit", value: wei,
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

export async function increaseTime(seconds) {
  await rpc("evm_increaseTime", [Number(seconds)]);
  await rpc("evm_mine", []);
}
