// One buy, no mandate — the swap layer on its own. Usage: AGENT_PK=0x… pnpm buy 20
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const usdc = process.argv[2] ?? "20";
const chain = chainByName();
const account = privateKeyToAccount(key);
const swap = swapProvider(undefined, chain);

// The amount is the one value a person types, so it is judged here, before anything reaches the chain.
// Left to the layers below, "abc" surfaces as a BigInt RangeError, "-5" as a viem uint256 range error
// and "0" as an on-chain `AS` revert — each a quote round-trip later, none of them naming the argument.
const reject = (reason) => { console.error(`usage: pnpm buy <usdc>  — ${reason}`); process.exit(2); };
let amountIn;
try { amountIn = parseUnits(usdc, chain.tokens.USDC.decimals); }
catch { reject(`"${usdc}" is not a decimal amount`); }
if (amountIn <= 0n) reject("amount must be positive");

const q = await swap.quote({ chainId: chain.chainId, tokenIn: chain.tokens.USDC.address,
  tokenOut: chain.tokens.WETH.address, amountIn, recipient: account.address, slippageBps: 50 });
const r = await swap.execute(q, account);
console.log(JSON.stringify({ ...r, amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString(),
  explorer: chain.explorerTx(r.txHash) }, null, 2));
