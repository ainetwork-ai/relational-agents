// Fork only. Gives the agent wallet gas, wraps 1 ETH and swaps it to USDC through Uniswap, so the
// family "has deposited" USDC without guessing a whale to impersonate.
import { privateKeyToAccount } from "viem/accounts";
import { parseEther, formatEther, erc20Abi } from "viem";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { giveEth, wrapEth } from "../fork.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required (an anvil key is fine on the fork)"); process.exit(2); }
const chain = chainByName();
const account = privateKeyToAccount(key);
const swap = swapProvider("router", chain);

await giveEth(swap.pub, account.address, "10");
await wrapEth(chain, account, parseEther("1"));
const q = await swap.quote({ chainId: chain.chainId, tokenIn: chain.tokens.WETH.address,
  tokenOut: chain.tokens.USDC.address, amountIn: parseEther("1"), recipient: account.address, slippageBps: 50 });
const r = await swap.execute(q, account);
// Both balances are read back, never computed: 10 given minus the 1 wrapped is not what is left,
// because the wrap, the approval and the swap each burned gas. A number printed as the demo's
// result has to be one the operator can check against the chain.
const usdc = await swap.pub.readContract({ address: chain.tokens.USDC.address, abi: erc20Abi,
  functionName: "balanceOf", args: [account.address] });
const eth = await swap.pub.getBalance({ address: account.address });
console.log(JSON.stringify({ agent: account.address, funded: { eth: formatEther(eth), usdc: usdc.toString() },
  tx: r.txHash, price: r.price }, null, 2));
