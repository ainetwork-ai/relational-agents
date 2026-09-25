import { createPublicClient, createWalletClient, http, erc20Abi, parseEther, keccak256, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { RPC, MAKER_PK, TAKER_PK, USDC, WETH } from "./config.js";

const chain = { ...base, rpcUrls: { default: { http: [RPC] } } };

export const publicClient = createPublicClient({ chain, transport: http(RPC) });
export const maker = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(MAKER_PK) });
export const taker = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(TAKER_PK) });

export { erc20Abi };

/** anvil cheat: give an account gas ETH. */
export async function setBalance(address, eth = "100") {
  await publicClient.request({ method: "anvil_setBalance", params: [address, `0x${(parseEther(eth)).toString(16)}`] });
}

/** Fund WETH the honest way — deposit() real ETH on the fork. */
export async function dealWETH(wallet, eth) {
  await setBalance(wallet.account.address, String(Number(eth) + 10));
  const hash = await wallet.writeContract({
    address: WETH,
    abi: [{ name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] }],
    functionName: "deposit",
    value: parseEther(eth),
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/** Fund real Base USDC by writing its balance slot (FiatToken keeps balances
 *  in slot 9 of the proxy). Verified against balanceOf after the write. */
export async function dealUSDC(address, amount6) {
  const slot = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [address, 9n],
  ));
  await publicClient.request({
    method: "anvil_setStorageAt",
    params: [USDC, slot, `0x${amount6.toString(16).padStart(64, "0")}`],
  });
  const got = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  if (got !== amount6) throw new Error(`USDC deal failed: expected ${amount6}, got ${got}`);
}
