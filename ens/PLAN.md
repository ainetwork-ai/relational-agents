# ENS Integration Plan — a name for every relationship

> Track requirement: ENS must be the agent's **identity layer**, not cosmetic.
> Functional demo, no hard-coded values. Standards: ENSIP-25 (registry name
> verification) + ENSIP-26 (agent text records).

Every relational agent already has an on-chain identity (ERC-8004 `agentId` in
`RelationalAgentRegistry`), its own wallet, an A2A endpoint, and an MCP memory
surface. ENS ties them into one resolvable identity:
**one relationship = one agent = one ENS name.**

## Design

### 1. Agent subnames (core)

The birth relay (the same call that runs `registerRelationalAgent`) also mints
an ENS subname for the agent under a parent we control:

```
chanho-ava-39065f.ainetwork.eth
└── <slugified room name>-<roomId 6> . ${ENS_PARENT_NAME}
```

- Sepolia ENS (same chain as the registry); NameWrapper + PublicResolver
  addresses from env — nothing hard-coded.
- Owner: the agent's own wallet (`getAgentWallet(agentId)`); the relayer pays
  gas, mirroring the gasless-birth UX. ENS failure never blocks a birth.

### 2. ENSIP-26 agent text records

Set at mint on the subname:

| record | value |
|---|---|
| `agent-context` | JSON: agent name, relationship, ERC-8004 registry + agentId, birth tx, pointers to the endpoint records |
| `agent-endpoint[a2a]` | `https://<host>/api/a2a/<agentUserId>` (agent card at `/.well-known/agent-card.json`) |
| `agent-endpoint[mcp]` | the relational-memory-mcp endpoint for this agent's bundle |
| `agent-endpoint[web]` | the room URL (human-facing) |
| `addr` / `avatar` / `description` | agent wallet / avatar / "Relational agent of <room>, born <date>" |

Any ENSIP-26 client can go name → `agent-context` → pick a protocol → talk to
the agent. Discovery needs nothing but the name.

### 3. ENSIP-25 registry ↔ name verification

- ENS side (the attestation): set text record
  `agent-registration[<registry as ERC-7930 interoperable address>][<agentId>]` = `"1"`
  on the subname — the name owner (the agent wallet) attests it IS that
  registry entry.
- Registry side: store the name in ERC-8004 metadata
  (`setMetadata(agentId, "ensName", name)`) and in the agent registration file
  (`agentURI` / agent card), so verifiers can start from the registry, build
  the ENSIP-25 key, resolve it on the claimed name, and accept on non-empty.

### 4. Member name resolution (UI)

Reverse-resolve member wallet addresses (consent banner, contract view,
on-chain system messages) to their primary ENS names; fall back to truncated
addresses. Cached on `users.ensName` at login.

### 5. Dissolution

Names are never burned — like the agent NFT, the name outlives the
relationship. The dissolve relay sets `relagent:dissolvedAt` on the name.

## Implementation steps

1. One-time setup script `ens/register-parent.mjs`: register + wrap
   `ainetwork.eth` on Sepolia, set resolver (uses `ens-cli` where convenient).
2. `app/src/lib/ens.ts` (viem): `mintAgentSubname()`, `setAgentRecords()`
   (ENSIP-26 set + ENSIP-25 attestation), `setDissolvedRecord()`,
   `resolveMemberName()`, `verifyAgentName()` (the ENSIP-25 check, used by the
   e2e and the UI badge).
3. Hook into the birth relay after `registerRelationalAgent` confirms; write
   `ensName` into ERC-8004 metadata + the agent card (`agentCardJson.ensName`).
4. Hook `setDissolvedRecord` into the dissolve relay.
5. UI: show the name in the room header + Agents section with a ✓ badge when
   `verifyAgentName()` passes (link → ENS app); reverse-resolve member names.
6. e2e: fresh consent → subname resolves; `agent-endpoint[a2a]` record answers
   with the agent card; ENSIP-25 key resolves to "1" from registry-side data
   only (proves no hard-coding).

## Env

```
ENS_PARENT_NAME=ainetwork.eth
ENS_REGISTRY=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e       # all chains
ENS_NAMEWRAPPER=0x0635513f179D50A207757E05759CbD106d7dFcE8   # Sepolia
ENS_PUBLIC_RESOLVER=0x8FADE66B79cC9f707aB26799354482EB93a5B7dD # Sepolia
# relayer reuses RELAYER_KEY / DEPLOYER_KEY
```

## Demo beat (15s, after the on-chain mint scene)

Agent posts: "🔤 I have a name — `chanho-ava-39065f.ainetwork.eth`". Cut to the
ENS app: `agent-context`, `agent-endpoint[a2a]`, and the
`agent-registration[…][…]` attestation. Then a terminal beat: `ens-cli` (or
curl) resolves the name → fetches the agent card → the agent answers over A2A.
Identity → discovery → conversation, all from the name.

## Stretch

- CCIP-Read offchain resolver so `agent-context` is always the live card.
- Member subnames (`chanho.ainetwork.eth`) + name-first invites.
