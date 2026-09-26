// app/src/lib/wallet/send.ts
// Send Sepolia USDC from the connected wallet — the only place the browser moves money.
import { erc20Abi, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { SEPOLIA_CHAIN_ID, SEPOLIA_USDC } from "@/lib/ens-family/config";
import { getWalletClient, toWalletError, WalletSignatureError } from "./provider";
import { ensureChain } from "./sign";

export async function sendUsdcTransfer(args: { from: Address; to: Address; amountMicro: bigint }): Promise<Hex> {
  try {
    const client = getWalletClient();
    const [account] = await client.requestAddresses();
    if (!account) throw new WalletSignatureError("no-account", "No wallet account is connected.");
    if (account.toLowerCase() !== args.from.toLowerCase()) throw new WalletSignatureError("failed", "wrong-account");
    await ensureChain(SEPOLIA_CHAIN_ID);
    return await client.writeContract({ account, chain: sepolia, address: SEPOLIA_USDC, abi: erc20Abi, functionName: "transfer", args: [args.to, args.amountMicro] });
  } catch (err) {
    throw toWalletError(err);
  }
}
