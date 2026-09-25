// One buy, no mandate — the swap layer on its own. Usage: AGENT_PK=0x… pnpm buy 20
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const usdc = process.argv[2] ?? "20";
const chain = chainByName();
const account = privateKeyToAccount(key);
const swap = swapProvider(undefined, chain);
const amountIn = BigInt(Math.round(Number(usdc) * 10 ** chain.tokens.USDC.decimals));

const q = await swap.quote({ chainId: chain.chainId, tokenIn: chain.tokens.USDC.address,
  tokenOut: chain.tokens.WETH.address, amountIn, recipient: account.address, slippageBps: 50 });
const r = await swap.execute(q, account);
console.log(JSON.stringify({ ...r, amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString(),
  explorer: chain.explorerTx(r.txHash) }, null, 2));
