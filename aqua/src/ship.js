// Ship an XYC (x*y=c) AMM strategy on the OFFICIAL Aqua registry, holding both
// legs in the maker's own wallet (self-custodial liquidity).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseUnits } from "viem";
import { Address } from "@1inch/sdk-core";
import { AquaProtocolContract } from "@1inch/aqua-sdk";
import { AquaXYCAmmStrategy, Order, MakerTraits } from "@1inch/swap-vm-sdk";
import { AQUA, SWAP_VM_AQUA_ROUTER, ROUTER_DOMAIN, CHAIN_ID, USDC, WETH, STATE_FILE } from "./config.js";
import { publicClient, maker, taker, erc20Abi, dealWETH, dealUSDC, setBalance } from "./clients.js";

const USDC_LEG = parseUnits("10000", 6);
const WETH_LEG = parseUnits("5", 18);

async function main() {
  const makerAddr = maker.account.address;
  console.log(`maker (LP): ${makerAddr}`);

  // fund the maker with both legs + gas; taker gets USDC to trade with
  await setBalance(makerAddr);
  await setBalance(taker.account.address);
  await dealWETH(maker, "5");
  await dealUSDC(makerAddr, USDC_LEG);
  await dealUSDC(taker.account.address, parseUnits("50000", 6));

  // single approve per token toward Aqua — the whole point: no pool deposits
  for (const token of [USDC, WETH]) {
    const hash = await maker.writeContract({
      address: token, abi: erc20Abi, functionName: "approve",
      args: [AQUA, 2n ** 256n - 1n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // the strategy program: constant-product curve, no per-strategy contract
  const program = AquaXYCAmmStrategy.new().build();
  const order = Order.new({
    maker: new Address(makerAddr),
    program,
    traits: MakerTraits.default(),
  });
  const strategyHash = order.hash({
    chainId: CHAIN_ID,
    name: ROUTER_DOMAIN.name,
    version: ROUTER_DOMAIN.version,
    verifyingContract: new Address(SWAP_VM_AQUA_ROUTER),
  }).toString();

  const aqua = new AquaProtocolContract(new Address(AQUA));
  const tx = aqua.ship({
    app: new Address(SWAP_VM_AQUA_ROUTER),
    strategy: order.encode(),
    amountsAndTokens: [
      { amount: USDC_LEG, token: new Address(USDC) },
      { amount: WETH_LEG, token: new Address(WETH) },
    ],
  });

  const hash = await maker.sendTransaction({
    to: (tx.to ?? AQUA).toString(),
    data: (tx.data ?? tx).toString(),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`ship() tx: ${hash} (${receipt.status})`);
  console.log(`strategy hash: ${strategyHash}`);

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({
    strategyHash,
    maker: makerAddr,
    orderJson: order.toJSON ? order.toJSON() : null,
    // encode() gives the bytes the router needs to rebuild the order
    orderEncoded: order.encode().toString(),
    tokens: { USDC, WETH },
    shippedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`state saved → ${STATE_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
