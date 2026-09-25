# Sui — the three-minute walkthrough

Everything here is live on **Sui testnet** and can be checked without trusting
us: the object, the transactions, and the blob are all public. What is *not*
public is the memory inside the blob, and that is the point.

The claim: **a relationship is a thing two people jointly own, and its memory
belongs to exactly those two.** On an EVM stack we approximate that with an NFT
in a registry plus an ACL row a server chooses to honour. Here the platform
says it directly.

| | |
|---|---|
| Package | [`0xfd759330…bcf5d8e4`](https://suiscan.xyz/testnet/object/0xfd759330549d6135cf85ca03786ca25c79d053b0167695d32f8df95bbcf5d8e4) |
| The relationship | [`0x47694faf…015f9933`](https://suiscan.xyz/testnet/object/0x47694faf5169cafb74c4d2124a251d2f4597611d319b014dfeeb0a03015f9933) |
| A second relationship | [`0xe80fa259…928c03ee`](https://suiscan.xyz/testnet/object/0xe80fa259f7910a17709080ef005f48aa3202ad3e4da54c677c9567a6928c03ee) |

Full evidence — every digest, every error verbatim — is in [PROOF.md](PROOF.md).

---

## 0:00 · The agent is an object two people own

Open the relationship object on Suiscan. It is a **shared** object of type
`relational_agent::RelationalAgent`, and its `members` field holds two
addresses. Neither person owns it alone; neither can transfer it away. Its
transaction list is the relationship's whole life: `create`, `add_memory`,
`dissolve`.

> On EVM the agent is a token id in a registry mapping. Here it is an
> addressable thing with its own fields and its own rules.

## 0:40 · The memory is a blob nobody can read

The egg-tart photo and its note were encrypted with **Seal** — 2-of-2 threshold
across the testnet key servers, under a policy bound to *this object's id* —
and the ciphertext went to **Walrus**. Only the blob id is on chain.

Fetch the blob yourself from the Walrus aggregator (no key required, that is
the point):

```bash
# the note; the photo is 8vhW7Qwa3VeXjh-vJ7YipqP-cQfiFYiSl_4ro-3hGpQ
curl -s https://aggregator.walrus-testnet.walrus.space/v1/blobs/F03E3p4ljJxb4LzAuQ-_R6h3cAdU5y1uWZLhQ_q6NiM | xxd | head -3
```

You get Seal metadata and then noise. Searching the blob for `egg tart` finds
nothing. **We hold this blob and we cannot read it either.**

## 1:20 · A member reads it

Run the same script the proof came from:

```bash
node sui/scripts/walrus-seal.mjs --sui <path/to/sui> --config <client.yaml> \
  --package 0xfd759330549d6135cf85ca03786ca25c79d053b0167695d32f8df95bbcf5d8e4
```

Member A holds nothing but their own key. The key servers dry-run our Move
`seal_approve`, see the address in `members`, and release their shares:

```
member_decrypt_note  { "status": "ok", "matchesOriginal": true,
  "preview": "# The egg tart\n\nWe walked past the bakery twice before going in..." }
member_decrypt_photo { "status": "ok", "bytes": 17054, "preview": "ffd8ffe0…JFIF" }
```

Byte-for-byte the original. The photo still has its JPEG magic.

## 2:00 · An outsider is refused — and so is the *other* relationship

The same script asks twice more, and both are turned away by the key servers,
not by our server:

```
outsider_decrypt_note      NoAccessError — "User does not have access to one or
                           more of the requested keys"
other_relationship_attempt NoAccessError — a member of relationship #2 presenting
                           THEIR object cannot unlock relationship #1's memory
```

The second one is the interesting refusal: being in *a* relationship is not
being in *this* one. `seal_approve` binds the decryption identity to the object
id, so Ava's agent cannot open Hannah's memory even though Ava is a legitimate
member of her own.

## 2:30 · It ends the way it began

`dissolve` is a member-signed transaction that stamps `dissolved_at_ms` and
flips the status. The object is **not** deleted and the blob is not erased —
what two people made together outlives the relationship, sealed to the people
who made it.

```bash
node sui/scripts/lifecycle.mjs --sui <path/to/sui> --config <client.yaml>
```

That script runs the whole chain-side story from scratch — publish, create,
add_memory, the non-member abort, a second relationship, dissolve — and writes
its receipt to `sui/lifecycle.json`.

---

## The one line for judges

> On our EVM version, isolation is a promise the server keeps.
> On Sui it is a fact the server cannot break — **we cannot read another
> couple's memories, and we can prove it in one curl.**

## What is honest about the scope

- Real on testnet: the object model, membership enforcement (proved by a
  *failed* transaction), Walrus storage, Seal encryption and all three refusals.
- Not wired yet: the in-app pipeline still writes through `okf-store`, and
  members here are ed25519 keypairs rather than zkLogin identities. Both are
  written up as next steps in [PROOF.md](PROOF.md#scope--what-is-real-and-what-is-next)
  — we would rather show a smaller thing that is true.
