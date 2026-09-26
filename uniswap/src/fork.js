import { createPublicClient, createWalletClient, http, toHex, parseEther } from "viem";
import { weth9Abi } from "./swap/abi.js";

/** anvil only: set a native balance. `wholeEth` is a decimal string like "5". */
export async function giveEth(pub, address, wholeEth) {
  await pub.request({ method: "anvil_setBalance", params: [address, toHex(parseEther(wholeEth))] });
}

/** Wrap native ETH into WETH from `account` (works on any chain; on the fork it follows giveEth). */
export async function wrapEth(chain, account, amountWei) {
  const wallet = createWalletClient({ account, chain: chain.viemChain, transport: http(chain.rpc) });
  const pub = createPublicClient({ chain: chain.viemChain, transport: http(chain.rpc) });
  const hash = await wallet.writeContract({ address: chain.tokens.WETH.address, abi: weth9Abi,
    functionName: "deposit", value: amountWei });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
