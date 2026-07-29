// Live proof: resolve the agent's ENS name on Sepolia and read back its
// ENSIP-26 records and ENSIP-25 registry attestation.
//
//   node ens/verify-resolution.mjs [name]
//
// viem is resolved from app/node_modules so this runs from anywhere in the repo.
import { createRequire } from "node:module";

const require = createRequire(new URL("../app/", import.meta.url));
const { createPublicClient, http } = require("viem");
const { sepolia } = require("viem/chains");

const NAME = process.argv[2] ?? "test-ava-dd51c5.ainetwork.eth";
const AGENT_ID = process.argv[3] ?? "3";
const RPC = process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
// ENSIP-25 key: the ERC-8004 relation registry as an ERC-7930 address, + agentId.
const REGISTRATION_KEY = `agent-registration[0x0001000003aa36a714f1dc0686c8b22a1afe8941c2613f7efa4e439256][${AGENT_ID}]`;

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

console.log(`name: ${NAME}\n`);
for (const key of [
  "agent-context",
  REGISTRATION_KEY,
  "agent-endpoint[a2a]",
  "agent-endpoint[mcp]",
  "agent-endpoint[web]",
  "description",
]) {
  const value = await client.getEnsText({ name: NAME, key });
  console.log(`getEnsText("${key}")\n  ${value}\n`);
}

console.log(`getEnsAddress()\n  ${await client.getEnsAddress({ name: NAME })}\n`);

const owner = await client.readContract({
  address: REGISTRY,
  abi: [
    {
      type: "function",
      name: "owner",
      stateMutability: "view",
      inputs: [{ name: "node", type: "bytes32" }],
      outputs: [{ type: "address" }],
    },
  ],
  functionName: "owner",
  args: [require("viem").namehash(NAME)],
});
console.log(`registry.owner(namehash)\n  ${owner}`);
