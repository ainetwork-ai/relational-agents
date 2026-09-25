// Base mainnet fork demo wiring. The Aqua registry address is the official
// deterministic deployment (same on every chain).
export const RPC = process.env.RPC ?? "http://localhost:8546";
export const CHAIN_ID = 8453;

export const AQUA = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimals
export const WETH = "0x4200000000000000000000000000000000000006"; // 18 decimals

// anvil's well-known test keys
export const PARENT_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // #0
export const CHILD_PK  = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // #1
export const MARKET_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // #2

export const EIGHTEEN_YEARS = 18n * 365n * 24n * 3600n;

export const STATE_FILE = new URL("../.state/vault.json", import.meta.url).pathname;
