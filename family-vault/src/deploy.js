// Deploy the custom router + the family's vault on the Base fork.
// The parent is the deployer; the capsule matures in 18 years.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AQUA, WETH, EIGHTEEN_YEARS, STATE_FILE } from "./config.js";
import { publicClient, parent, child, artifact, dealETH } from "./clients.js";

await dealETH(parent.account.address, 10n ** 19n);
await dealETH(child.account.address, 10n ** 19n);

const now = (await publicClient.getBlock()).timestamp;
const unlockAt = now + EIGHTEEN_YEARS;

const routerArt = artifact("FamilyVaultSwapVM");
let hash = await parent.deployContract({
  abi: routerArt.abi, bytecode: routerArt.bytecode,
  args: [AQUA, WETH, parent.account.address],
});
const router = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;

const vaultArt = artifact("FamilyVault");
hash = await parent.deployContract({
  abi: vaultArt.abi, bytecode: vaultArt.bytecode,
  args: [AQUA, router, parent.account.address, child.account.address, unlockAt],
});
const vault = (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;

mkdirSync(dirname(STATE_FILE), { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify({
  router, vault,
  parent: parent.account.address,
  child: child.account.address,
  unlockAt: unlockAt.toString(),
  deployedAt: now.toString(),
}, null, 2));

console.log(`FamilyVaultSwapVM (custom router): ${router}`);
console.log(`FamilyVault:                       ${vault}`);
console.log(`parent ${parent.account.address} · child ${child.account.address}`);
console.log(`capsule matures at ${new Date(Number(unlockAt) * 1000).toISOString()} (+18y)`);
