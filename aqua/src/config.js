// Canonical 1inch deployments — deterministic, same address on every chain.
// The bounty requires the OFFICIAL Aqua/SwapVM contracts; we run against a
// Base mainnet fork (local forks are explicitly allowed for the demo).
export const AQUA = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";
export const SWAP_VM_AQUA_ROUTER = "0x111111338c5091E8440b67B168bAe16a668AC0De";

// EIP-712 domain of the live router on Base (read via eip712Domain()).
export const ROUTER_DOMAIN = { name: "1inch SwapVM v1.0", version: "1.0.2" };

export const CHAIN_ID = 8453; // Base (forked)
export const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8546";

// Real Base tokens — the fork carries their real bytecode and state.
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimals
export const WETH = "0x4200000000000000000000000000000000000006"; // 18 decimals

// Throwaway anvil keys (never funded outside the fork).
export const MAKER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
export const TAKER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1

export const STATE_FILE = new URL("../.state/strategy.json", import.meta.url).pathname;
