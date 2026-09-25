# ENS — Best ENS Integration for AI Agents

## How we use ENS

In our project, an agent is born from a *relationship* — it's minted in an
ERC-8004-compatible registry only when both people sign an EIP-712 consent.
ENS is the identity layer that makes that agent nameable, discoverable, and
verifiable:

- **A name at birth.** The same relay that mints the agent on-chain also mints
  it an ENS subname (e.g. `chanho-ava-39065f.ainetwork.eth`) on Sepolia, owned
  by the agent's own wallet. Nothing is hard-coded: the name is derived from
  the room, and records are written from live registry data.
- **ENSIP-26 agent text records for discovery.** Each agent name carries
  `agent-context` (who the agent is: relationship, registry address, ERC-8004
  agentId, birth tx) plus `agent-endpoint[a2a]` (its A2A agent card),
  `agent-endpoint[mcp]` (its relational-memory MCP surface), and
  `agent-endpoint[web]`. Any ENSIP-26 client can go from the name alone to a
  live conversation with the agent — resolve, pick a protocol, talk.
- **ENSIP-25 registry verification.** The name attests
  `agent-registration[<registry as ERC-7930>][<agentId>]` = "1", and the
  registry stores the name in the agent's registration data — so a verifier
  starting from our registry can deterministically confirm the ENS name really
  is that agent. The app shows the verified name only when this check passes.
- **Human names too.** Member wallet addresses in the consent contract UI
  reverse-resolve to their primary ENS names.

## Why we qualify

ENS isn't decoration here — it's how our agents exist to the outside world.
Our agents are jointly owned by two people (the NFT is held by the registry;
no single owner), so a wallet address alone is a poor identity; the ENS name
*is* the agent's public identity, the entry point to its A2A/MCP endpoints,
and the proof (via ENSIP-25) that the name and the registry entry are the same
being. We implement both agent-focused ENSIPs (25 & 26) end-to-end, on a
functional demo with live minting — every name, record, and attestation is
generated at agent birth from on-chain data.
