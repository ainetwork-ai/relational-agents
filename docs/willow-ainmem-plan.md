# ainmem on Willow — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pages someone has visited open and edit with no network. In a teamspace
linked to an aindrive drive, every edit is signed by the browser's device key, lands
in the drive's Willow store, and shows "Last edited by Mom · signed".

**Architecture:**
- **Offline.** A service worker serves the last copy of visited pages and the app's
  static files. On mount, the editor replays the transactions still waiting in
  IndexedDB on top of that copy.
- **Signing.**
  - The browser keeps a WebCrypto Ed25519 key. aindrive certifies it through the
    person's connected aindrive account, and ainmem vouches that the key belongs to
    the ainmem user (an HMAC binding).
  - In a linked teamspace, the queue signs each transaction as a Willow entry at
    `["ainmem", teamspaceId, pageId, txId]` before storing it.
  - The server verifies the entry, forwards it to aindrive's new ingest endpoint
    (aindrive runs its own policy), and applies it.
- **Authorship.** Authors come back from aindrive's store, verified, and are joined
  per block with ainmem's `transactions` table.

**Tech:**
- Next 16 app router.
- WebCrypto Ed25519 on both sides (Node 22 and current browsers), and @noble/hashes
  sha256.
- The Willow entry encoding is reimplemented in 20 lines and pinned by a vector made
  with aindrive's real `encodeEntryBytes`.

**Spec:** `docs/willow-offline-authorship-design.md`. aindrive: `docs/superpowers/specs/2026-09-26-willow-local-first-docs-design.md`.

## Global Constraints
- **No schema change** (pushing is a human's call). Entries live in aindrive's store,
  and ainmem keeps using `transactions`.
- **No new npm dependency in ainmem** (pnpm is unusable here). Use WebCrypto plus
  @noble/hashes, which is already installed.
- **Language.** English everywhere; Korean only in `app/src/i18n/ko.ts`.
- **Commits.** Stage one path at a time with `git add <path>`.
- **Unlinked teamspaces and personal pages.** Unchanged, apart from offline.
- **Unsigned edits in a linked teamspace** are still accepted and are shown as not
  signed. These come from AI and agents, old tabs, and people with no aindrive
  account (spec §6).

## Review Focus
1. **Logging out on a shared browser:** the next person must not see the last person's cached pages. Logout clears the caches.
2. **A signed transaction whose payload differs from the body's operations:** the payload wins, since it is what was signed.
3. **A device key bound to user A, used in user B's session:** refused.
4. **aindrive down:** the edit is applied and the browser keeps retrying the forward. Nothing is lost, and nothing is applied twice.
5. **aindrive refuses** (revoked device, a stranger's key): the edit is not applied, and the queue drops it with "rejected".

---

### Task 1: replay queued transactions on open (offline edits survive a reload)
**Files:** `app/src/lib/editor/transaction-queue.ts`, `app/src/components/editor/block-editor.tsx`, `app/e2e/offline-replay.spec.ts`
- `TransactionQueue.pendingFor(pageId): Promise<Transaction[]>` returns every stored row for the page, from any session, oldest first, merged with the ones in memory.
- `BlockEditor` mount: after the mount sync (`applyRemote`) settles, apply `pendingFor(pageId)` through `applyRemoteTransactions`. Text ops are idempotent (an RGA merge of known ids is a no-op).
- `applyRemote` gains a `then` hook so the replay runs after it.
- Test (Playwright, own server):
  1. Stop the network so saves fail (`page.route('**/api/saveTransactions', abort)`) and type "offline words".
  2. Reload with saves still failing: the text is on screen.
  3. Unblock: the server has it.

### Task 2: service worker (visited pages open offline)
**Files:** `app/public/sw.js`, `app/src/components/offline/sw-register.tsx` (mounted in `(app)/layout.tsx`), `app/src/components/logout-button.tsx` and `workspace-switcher.tsx` logout (clear), `app/e2e/offline-open.spec.ts`
- Navigations (`mode: navigate`, same origin): network first. A good 200 HTML is cached under its URL without the search part, and served when offline.
- `/_next/static/*`: cache first.
- `GET /api/*`: network first with a cache fallback. Excluded: event streams (`accept: text/event-stream`), `/api/files`, `/api/upload`, `/api/uploads`, and responses over 2 MB or not JSON.
- RSC requests (header `rsc: 1`) are never cached. When one fails, Next falls back to a hard navigation, which the worker serves.
- A `{type:"clear"}` message deletes every cache; logout posts it before it navigates.
- Test: visit a page, go offline (`context.setOffline(true)`), reload, and the title and a block are visible. Type, go online, and the server has the text.

### Task 3 (aindrive repo): ainmem entries in the drive store
**Files (aindrive worktree `willow-spec`):**
- `web/lib/willow/peer.ts`: `acceptFor(driveId, store, opts?: { vouchedBy?: string })`.
- `web/app/api/willow/ingest/route.ts`, `web/app/api/willow/ainmem-authors/route.ts`.
- `web/app/api/willow/cert/route.ts`: bearer.
- Tests: `web/lib/__tests__/willow-ainmem.test.ts`.

**Policy and routes:**
- `acceptFor` for `["ainmem", ts, page, tx]`:
  - Exactly 4 components.
  - The signer resolves to a person, and is not revoked.
  - Payload at most 1 MiB.
  - Either the signer has editor on the drive root, or `vouchedBy` has editor or owner on the drive root. Only the ingest route passes `vouchedBy`, as the caller whose bearer it holds.
  - Anything else is "outside-grant" as before.
- `allowFor`: `ainmem` entries go to viewers of the drive root.
- `POST /api/willow/ingest {drive, entries: WireJson[]}`:
  - Requires a signed-in user (cookie or bearer).
  - At most 200 entries, and only `_id/cert` or `ainmem` paths.
  - Each entry runs through `acceptFor(…, {vouchedBy: user})`, then `store.ingestEntry` and `ingestPayload`.
  - Returns `{results: (null | reason)[]}`.
- `GET /api/willow/ainmem-authors?drive&teamspace&page`: viewer on the drive root. Returns `[{tx, userId, name, strength, at}]` from the entries under `["ainmem", ts, page]`, resolved with `resolvePerson` and the store's certs and revocations.
- `/api/willow/cert` uses `getRequestUser(req)`, so ainmem's server can ask on behalf of the person with their session JWT.
- Tests:
  - A vouched entry from a non-member signer is accepted.
  - Unvouched, the same entry is refused.
  - A revoked device is refused.
  - A 5-component path is refused.
  - `ainmem-authors` returns the signer's name and strength.

### Task 4: entry codec (ainmem)
**Files:** `app/src/lib/willow/entry.ts`, `app/src/lib/willow/entry.vectors.json` (made in aindrive by a one-off script and committed), `app/scripts/willow-entry.check.mts`
- `namespaceOf(driveId)`, `encodeEntryBytes(e)` (Willow's encoding with aindrive's path scheme: ns 32, subspace 32, count u8, components u16-length-prefixed, timestamp u64be, length u64be, digest 32).
- `signTransaction(key: CryptoKeyPair, pub: Uint8Array, {driveId, teamspaceId, t}): Promise<WireJson>`.
- `verifyTransactionEntry(w: WireJson, {driveId, teamspaceId, pageId, id}): Promise<{ok: true, t: Transaction, deviceKey: string} | {ok:false, reason}>`.
- `WireJson` is aindrive's wire format: `{s, p[], ts, n, d, tok, pl}`, with hex fields and a base64 payload.
- Tests:
  - The vectors' bytes match exactly.
  - Sign then verify round trip.
  - Refused: a tampered payload, the wrong path, a wrong key, and a digest mismatch.

### Task 5: device identity (ainmem)
**Files:** `app/src/lib/willow/device.ts` (browser), `app/src/lib/willow/binding.ts` (server), `app/src/app/api/willow/device/route.ts`
- **Browser:** `deviceFor(userId)`. It keeps a non-extractable Ed25519 key pair in IndexedDB (`ainmem-willow`) and caches `{binding, certEntry per drive}` in localStorage. `ensureCert()` calls `POST /api/willow/device {deviceKey}`.
- **Server:**
  - If the user has no connected aindrive account, answer 409 "connect aindrive".
  - Otherwise `runAs(user)` → aindrive `POST /api/willow/cert {deviceKey, label: "ainmem browser"}`, and return `{cert, binding}`.
  - `binding = HMAC-SHA256(SESSION_SECRET, "ainmem-device:" + userId + ":" + deviceKey)`.
- The browser signs the `_id/cert` entry itself (payload = cert JSON) per drive, when it first signs for that drive.
- Test (check script): the binding verifies for the same user and key, and fails for another user.

### Task 6: sign in the queue, verify and forward on save
**Files:**
- `transactions/types.ts`: `Transaction.signed?: WireJson`, and `SaveRequest.willow?: {deviceKey, binding, certs: Record<driveId, WireJson>}`.
- `transaction-queue.ts`: `setSigner(pageId, signer | null)`. The signer signs in `enqueue` before the IndexedDB write.
- `block-editor.tsx`: gets `willow?: {driveId, teamspaceId}` from `page.tsx` through `PageView`.
- `lib/willow/record-drive.ts`: `recordDriveOf(teamspaceId)`, the earliest linked drive.
- `saveTransactions/route.ts`.

**Server, per transaction:**
- Page in a linked teamspace, transaction signed:
  - `verifyTransactionEntry` passes.
  - Binding valid for the session user.
  - The `s` field equals `willow.deviceKey`.
  - Then forward `[certs[drive], …entries]` to aindrive ingest, `runAsOrService(drive.createdBy)`.
- aindrive refused the transaction → it goes into `rejectedIds` and is not applied.
- aindrive unreachable → apply, and answer 503 so the queue retries later (the apply is idempotent by id).
- Invalid signature or binding → rejected.
- Unsigned → as today.

**Tests:**
- e2e with a fake aindrive: a signed edit is applied and the fake receives the entry. With the fake answering "revoked", the edit is dropped. With the fake down, the edit is applied, a 503 is answered, and the retry later forwards it.
- Check script: verify on a forged body is refused.

### Task 7: "Last edited by · signed" in the block menu
**Files:** `app/src/app/api/pages/[pageId]/authors/route.ts`, `app/src/components/editor/block-row.tsx`, `app/src/i18n/ko.ts`
- `GET /api/pages/:id/authors` needs view access. It reads the page's `transactions` in order, and each block's last transaction id is the last one touching `pointer.id`. aindrive's `ainmem-authors` then maps tx → `{name, strength}`.
- Returns `{blocks: {[blockId]: {name, signed: "wallet" | "attested" | null, at}}}`. An unsigned transaction gives the ainmem user's name and `signed: null`.
- The grip menu footer shows "Last edited by {name}" and, when signed, "Signed · wallet" or "Signed · vouched by aindrive".
- Test: the e2e from Task 6 opens the grip menu and sees "Signed".

### Task 8: final review
- Package the diff, review it on opus, then one fix pass.
