# World — AgentKit New Use Cases

## How we use the protocol

Our agent is born from a *relationship*: it exists only after **two distinct
humans** each prove personhood with **World ID** and co-sign an EIP-712
consent. Each signer completes an IDKit proof (`action: relation-consent`,
`signal = relationId`) before signing; the backend verifies it against the
World cloud verifier and the relay carries **both `nullifier_hash`es
on-chain** into our ERC-8004-compatible registry
(`registerHumanBackedAgent`), so the agent's identity permanently records two
independent proofs of personhood — one per party, Sybil-checked (the same
nullifier on both parties reverts).

**AgentKit** gives the relationship agent its economic hands: at birth it is
provisioned a CDP/AgentKit smart-account wallet, and it performs a real
on-chain action for the relationship — an **x402 USDC payment** to a seller
service on Base Sepolia. The seller's middleware settles **only if
`isHumanBacked(relationId)` is true on-chain** — i.e. only when two verified,
consenting humans stand behind the paying agent. A bot wallet, or a Sybil
"couple" backed by one human, gets rejected — live, in the demo.

## Why we qualify

This is a genuinely **new AgentKit use case**: not a human's assistant with a
wallet, but a **dual-human-backed agent** whose spending power is gated on
*two-person* personhood. It unlocks joint/dual-authorized commerce — couples'
escrow, "both must agree" purchases, no-Sybil limited drops — a trust model a
single-human design cannot express. AgentKit is load-bearing (the agent's
wallet and the payment flow), personhood verification is on-chain and
per-party, and the flow runs end-to-end: verify → co-sign → birth →
AgentKit pays → seller checks `isHumanBacked` → goods delivered, with the
bot/Sybil rejection shown side by side. No reputation scores, no content
generation, no API-discount perks — a service that can finally tell "a bot"
from "an agent two real humans stand behind."
