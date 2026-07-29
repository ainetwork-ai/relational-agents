# Sui — Best App Built on Sui

## How we use the protocol

Our product is one idea: *a relationship is a thing two people jointly own,
and its memory belongs to exactly those two people.* On Sui that idea is
expressed by the platform itself, not approximated:

- **Object model** — the agent *is* a `RelationalAgent` **shared Move
  object**: `members`, status, and a vector of memory references live on the
  object. Birth is a **co-signed PTB** calling `create` — the chain itself
  refuses an agent that both people didn't sign for. Dissolve is a second
  co-signed PTB; the object is never deleted — the record outlives the
  relationship.
- **Seal** — every memory (the relationship document, the photos) is
  **threshold-encrypted** with a policy bound to the object: our Move
  `seal_approve` only lets an address in `members` derive the key. Isolation
  stops being a server-side filter and becomes cryptography — the Chanho–Ava
  agent *cannot* decrypt the Chanho–Hannah memory, and **neither can we, the
  operators**.
- **Walrus** — the ciphertext blobs live on Walrus; the Move object holds
  only `blobId`s. Memories are decentralized and content-addressed, not files
  on our server.
- **zkLogin (Enoki)** — two ordinary humans onboard with the Google account
  they already have; no seed phrase, no extension, and each gets the Sui
  address the consent PTB is signed with.

## Why we qualify

Every headline Sui primitive does **load-bearing** work for this specific
product: the object model *is* joint ownership, Seal *is* our core privacy
promise made physical, Walrus *is* the memory, zkLogin *is* how two
non-crypto humans meet on-chain. Remove any one and the product breaks —
the opposite of a superficial add-on (we deliberately left DeepBook out
rather than bolt on a shallow cameo). The demo runs live on Sui testnet,
built this weekend: zkLogin onboarding → co-signed birth → a sealed egg-tart
memory → a member reading it → a *non-member and the server operator both
failing to decrypt it on screen* → co-signed dissolve. On our EVM version,
isolation is a promise the server keeps; on Sui it's a fact the server can't
break.
