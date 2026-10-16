# ainmem on Willow: offline pages and signed authorship

Date: 2026-09-26 · Status: implemented (docs/willow-ainmem-plan.md) · Depends on aindrive's
`docs/superpowers/specs/2026-09-26-willow-local-first-docs-design.md` (called "the
aindrive spec" below) for identity, namespaces and the server peer.

## 1. Goal

1. **Offline.** A page someone has visited opens and edits with no network, and its
   edits reach everyone when the network returns. This is for every page, since it
   costs the same.
2. **Who wrote what, provably.** In a teamspace linked to an aindrive drive, every edit
   is signed by the device that made it, is bound to a person, and lands in the
   family's own drive as Willow entries. Anyone holding the drive can check who
   changed what without trusting ainmem's server.
3. **No extra steps**, as in the aindrive spec.

Unlinked teamspaces keep today's authorship (a `userId` per transaction, recorded by
the server).

## 2. What is there today (verified 2026-09-26)

- Postgres is the source of truth; edits are transactions (`POST /api/saveTransactions`,
  idempotent by id), queued in IndexedDB before sending and retried every 5 s
  (`app/src/lib/editor/transaction-queue.ts`). Fan-out is SSE.
- Text is ainmem's own RGA CRDT with Peritext-style marks (`app/src/lib/text-crdt/`);
  block fields are last-writer-wins.
- No service worker: reload or opening a page offline fails.
- Authorship: `transactions.userId`; nothing signed; CRDT ids carry the tab's session id.
- aindrive link: `teamspace_drives`; pages are exported one way as `.md`
  (`app/src/lib/aindrive-backup.ts`).

## 3. Decisions

| # | Decision | Why |
|---|----------|-----|
| A1 | **Keep ainmem's CRDT and transaction format.** A transaction becomes the payload of one Willow entry; nothing moves to Yjs. | The editor, save protocol and Notion parity work stay untouched. Willow carries the transactions; it does not change what they mean. |
| A2 | **Linked teamspace → entries in the drive's namespace** at `["ainmem", <teamspaceId>, <pageId>, <txId>]`, in the subspace of the editing browser's device key. | Same namespace, identities and membership grants as aindrive documents, so the family's drive holds ainmem history with authors. |
| A3 | **The ainmem server is a Willow peer.** It verifies each entry (signature + the aindrive spec's ingest policy), applies the transaction to Postgres through the existing `apply.ts`, and syncs the entries with aindrive's server peer over WGPS. | Postgres stays the fast read model; the entries are the record. |
| A4 | **Transport stays the save endpoint**, with the body a Willow Drop (sideloading format) of signed entries. | The queue, retry and idempotency already work. |
| A5 | **One identity across ainmem and aindrive.** An ainmem browser's device key gets its certificate the aindrive way: a wallet sign-in carries the key in the signed message; otherwise aindrive's attestation key signs it through the account ainmem is already linked to (`aindrive_accounts`). | "Mom" in ainmem and "Mom" in the drive's grants are the same person. |
| A6 | **A service worker** caches the app shell and each visited page's last snapshot (`page_snapshots` shape) in IndexedDB. | Goal 1 for every page. |

## 4. Components

| Unit | Where | Does |
|---|---|---|
| Device key + certificate | `app/src/lib/willow/identity.ts` | the aindrive spec §4, for an ainmem browser |
| Entry codec | `app/src/lib/willow/tx-entry.ts` | transaction → signed entry → Drop; Drop → verified transactions |
| Queue change | `transaction-queue.ts` | in a linked teamspace, sign before queuing; the rest unchanged |
| Server peer | `app/src/lib/willow/peer.ts` | verify + policy, apply, store entries, WGPS to aindrive |
| Offline cache | `app/public/sw.js`, `app/src/lib/offline/` | app shell, page snapshots, "available offline" state |
| Authorship UI | block editor | "edited by Mom · verified (wallet / vouched by aindrive)" per block; per-character via CRDT ids ↔ device keys (a transaction records its tab's clientId, so each CRDT item maps to a signed author) |

## 5. Data flow

**Edit in a linked teamspace.** Op → transaction → signed entry (device key) → IndexedDB
queue → Drop in `POST /api/saveTransactions` → server verifies and applies → SSE to
other tabs → the entry syncs to aindrive's server peer and on to the family's devices.

**Offline.** Edits queue as today (now signed). The page opens from its cached snapshot
plus the queued transactions replayed on it. On reconnect the queue drains; conflicts
merge as today (CRDT for text, LWW for fields).

**Unlinked teamspace.** Same as today, plus the offline cache.

## 6. Errors

- **A signature that does not check out** (a rotated secret, a page moved out of the
  teamspace, a removed device, aindrive refusing it). The edit still applies, unsigned,
  and the browser fetches a fresh certificate.
  - Unsigned edits are accepted anyway (AI, agents, people without an aindrive account),
    so refusing would only lose honest people's text and protect nothing (final review
    C1; this replaces "not saved: no permission").
  - The authors view shows the edit as not signed.
- **aindrive unreachable.**
  - ainmem applies the edit and answers 200 with the ids it could not record.
  - The browser keeps those rows, marked, and hands them in again through
    `/api/willow/record` until the drive has them. Pages keep working, and the save
    badge says saved.
- **A teamspace linked after pages exist.** Earlier history stays unsigned and is shown
  as such; signing starts with the link.
- **Another person signing in on the same browser.**
  - The last person's offline pages and signing keys are removed.
  - Their unsent edits stay stored and are sent only when they are back.

## 7. Testing

- `tx-entry`: round trip; a tampered payload or wrong key is refused.
- API: a Drop with a non-member's entry is refused; a replayed Drop is idempotent.
- E2E: offline (`context.setOffline(true)`) reload of a visited page, edit, reconnect,
  second browser sees it with a verified author; the entry appears in the linked drive.

## 8. Out of scope

- Editing the exported `.md` in aindrive and flowing it back into the page (the backup
  stays one-way).
- Unvisited pages offline; ainmem without a network on first load.
