# ENS Family Names in Workspace Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workspace admin opens **Settings → Workspace → Family names**, connects MetaMask to their current account if needed, checks that the family's name is free in the **global `.eth` registry**, registers it (e.g. `lee.eth`) and adds family members as subnames, approving every Sepolia transaction in their own wallet. This replaces the CLI setup script as the demo's first scene; the existing "pocket money by name" flow then works on that family.

**Architecture:** The write logic moves into `ens/src/issue.ts`, written against any viem `WalletClient` so the **browser runs it with the admin's MetaMask**. The family root is a second-level `.eth` name registered through the public **ETHRegistrar** (commit → wait → register, paid in Sepolia MockUSDC, which anyone can mint). The server sends **no transactions**: it checks availability, holds a short reservation, and saves the workspace → name mapping only after reading onchain that the admin's wallet owns the name. A new **wallet-link** route attaches a MetaMask address to the signed-in account (no account switch), reusing the existing challenge and EIP-191 check.

**Tech Stack:** TypeScript · viem 2.55 · ENSv2 Sepolia · Next.js App Router · drizzle · MetaMask (EIP-1193).

**Builds on:** `docs/superpowers/plans/2026-09-26-pocket-money-by-name.md` (tasks 1–13 done) and spec `ens/plan-family-namespace.md`. Contract facts: `ensdomains/contracts-v2@71a3b73`.

## Verified current state (2026-09-26)

| What | Where | Fact |
|---|---|---|
| Settings modal | `app/src/components/settings/settings-modal.tsx:13,108-123` | `SettingsTab = "account" \| "preferences" \| "general"`; the "Workspace" nav group holds only General |
| MetaMask sign-in | `app/src/components/login-form.tsx:68-138` | Revoke/request permissions → `eth_requestAccounts` → `GET /api/auth/challenge` → `personal_sign` → `POST /api/auth/metamask-verify` |
| Challenge | `app/src/app/api/auth/challenge/route.ts` | Stores a nonce in `session.challenge`; the signed message is `challengeMessage(nonce)` (`lib/auth/ain-verify`) |
| What sign-in does | `app/src/app/api/auth/metamask-verify/route.ts` | Verifies with `verifyEthSignature` (`lib/auth/eth-verify`), then finds or **creates** the user whose `ainAddress` is the wallet and signs **that** user in. It never attaches a wallet to the current account |
| Wallet column | `app/src/lib/db/schema.ts:40` | `users.ainAddress` is `text("ain_address").unique()`, stored lowercase; `session.ainAddress` mirrors it |
| Browser writes | `app/src/lib/wallet/send.ts`, `provider.ts`, `sign.ts` | `getWalletClient()`, `ensureChain(SEPOLIA_CHAIN_ID)`, `toWalletError`; `sendUsdcTransfer` refuses when MetaMask's account is not the expected one — the pattern to copy |
| Admin check | `app/src/lib/auth/workspace-role.ts:51` | `requireWorkspaceRole(workspaceId, userId, "admin")` |
| Global `.eth` registration | `ens/src/abi.ts` `ethRegistrarAbi`, `ens/src/config.ts` (`ETH_REGISTRAR 0xabe7…94ca`, `ETH_REGISTRY 0x657e…e09e`, `MOCK_USDC 0x16f9…8a8e`) | `isAvailable(label)`, `getRegisterPrice(label, duration, token)`, `makeCommitment`, `commit`, `register(label, owner, secret, subregistry, resolver, duration, token, referrer)`, `MIN_COMMITMENT_AGE()`; MockUSDC has an open `mint`. Already used once by `ens/scripts/setup-family.ts:157-170` to register `ainmem.eth` |
| Existing demo family | onchain | `kim.ainmem.eth` (issued by the CLI under `ainmem.eth`) stays as it is and keeps working through the env fallback |
| Send skill | `app/src/lib/ens-chain.ts` | One family per deployment via `ENS_FAMILY_ROOT`; `createFamilyChain({ root })` works for any root name, `lee.eth` included |

## Decisions (2026-09-26)

| # | Decision | Why |
|---|---|---|
| F1 | **The family root is a `.eth` name in the global registry**: `<label>.eth`, registered through `ETHRegistrar` by the admin's wallet, owned by the admin's wallet, with the family's own UserRegistry as its subregistry | User decision. Anyone may register a `.eth` name, so no server key and no `ainmem.eth` are involved |
| F2 | **The admin pays everything from their own wallet**: Sepolia ETH for gas and MockUSDC for the registration fee (the panel mints the MockUSDC itself; it is free on Sepolia). Before starting, the panel shows the fee and the number of approvals, checks the wallet's Sepolia ETH, and links a faucet if it is short | User decision: users pay their own gas |
| F3 | **Registration period is chosen at creation (1, 2 or 5 years; default 1)**, and the family tab has **Renew**. A `.eth` name expires, and every name below it stops resolving with it (spec, tree rules), so renewal is part of the feature, not an extra. Renewal at contracts-v2@71a3b73 (`AbstractETHRegistrar.sol:93`, `IETHRenewer`): `renew(RenewData{label, duration, referrer}, paymentToken)` — **anyone may call it** and pays with `msg.sender`'s tokens (`safeTransferFrom(msg.sender, BENEFICIARY, …)`); price from `getRenewPrice(label, duration, token)`; `isRenewable(label)` stays true through the grace period, `getRemainingGracePeriod(label)` says how long is left. No commit–reveal: 1 approval for the renewal plus mint/approve of MockUSDC when short | Without renewal, the family silently stops working after a year |
| F4 | **Link a wallet to the current account.** The tab works only when the signed-in user has `ainAddress`. Otherwise it shows **Connect MetaMask**, which signs the existing challenge and posts it to a new `POST /api/auth/wallet-link`. The account, session user and active workspace stay the same | User decision; reuses the challenge + `verifyEthSignature` of the MetaMask login |
| F5 | Only workspace **admins/owners** can create the family or add members; every member can view the tree | Matches existing settings permissions |
| F6 | One family per workspace, stored in a new table `workspace_ens` (`workspace_id` PK, `root_name` unique, `from_block`, `created_by`, `created_at`). Pushed by hand per CLAUDE.md | The app must know which family a workspace has; ENS cannot be searched by record |
| F7 | The admin's wallet deploys and holds all roles on the family registry, the family resolver and every registry below; the admin is the tree's first person (`<their label>.<family>.eth`). Each person's resolver grants `ROLE_SET_ADDRESS` to that person's wallet | Same trust model as the CLI setup, with the admin in the deployer's place |
| F8 | Adding a member happens **on a family tree canvas** (Task 7b): a dotted "+ Add a child" card under each person and "+ Add spouse" beside the unmarried ones open into the form in place; the new card fills from dotted to solid as the approvals go through and ends by resolving its own name live. The new person **must have a wallet**: a workspace member who connected MetaMask (picked from a list) or a pasted address. Label and alias are typed; relation comes from the card (son/daughter chosen for a child) | The branch growing is the scene to show; wallet-less members were ruled out (2026-09-26). Invitations: see Open decisions |
| F9 | Progress lives **in the browser**: the panel runs the steps one by one, each waiting for a MetaMask approval and a receipt, and shows ✓ + an Etherscan link per step. Leaving midway is safe: every step is resumable (F12). The commit secret and deployed addresses are kept in `localStorage` `ens-family:<workspaceId>` | No server job runner needed; commit → register must survive a reload |
| F10 | The send skill looks up the workspace's family first, then falls back to `ENS_FAMILY_ROOT` | The existing kim demo keeps working |

### Name uniqueness (the global registry decides)

| # | Decision | Why |
|---|---|---|
| F11 | **Family name:** free means `ETHRegistrar.isAvailable(label) == true` — the global `.eth` registry's own answer, which also covers names in their grace period or still owned by someone else. The price comes from `getRegisterPrice(label, 1 year, MOCK_USDC)` (short labels cost more; a recently expired name may carry a premium — both shown). The app DB is never asked whether a name is free; `workspace_ens.root_name` is `unique` only as a second net | The `.eth` registry is the only place that knows every name, including names registered by other apps or people |
| F12 | **Checked at four moments:** while typing; before the first MetaMask approval; right before `commit`; right before `register` (after the wait). If the name was taken in between, the run stops **before** the next paid step with "lee.eth was just registered by someone else" and suggestions. The commit-reveal itself stops anyone from sniping the name from our pending `register` transaction | Registration takes several approvals and a wait; the name can go in between |
| F13 | **Resuming never adopts someone else's name.** Resume treats an existing name as "done" only if it is **ours**: for `<label>.eth`, `findExactOwner(dnsEncode("<label>.eth")) == adminWallet` and its subregistry is the family registry we deployed; for a member, the resolver is the CREATE2 address this account would have deployed or the owner is the expected wallet. Otherwise it stops with `taken` | Otherwise a taken name would be skipped as "already done" and the family would be built on someone else's name |
| F14 | **Reservation inside the app:** pressing Create calls `POST …/ens/reserve`, which re-checks F11 and holds the label for this workspace for 30 minutes (in memory, one server). Another workspace in this app sees `reserved` | Two admins of this app racing for `lee` must not both pay for contracts only one can use. It cannot stop outsiders; F12 covers them |
| F15 | **Inside one family:** a member label must be free under its parent (`findExactOwner` of the full name is zero **and** the parent registry's `getResolver(label)` is zero); an address may appear **once** in the tree (the send flow finds "who am I" by address, D2 of the pocket-money spec); an alias equal to another alias in the tree (case-insensitive) is allowed with the note "Two people will be called Minjun — the agent will ask which one when sending" | Duplicate labels revert; duplicate addresses break the sender lookup; duplicate aliases only cost a question |

## Global Constraints

- Sepolia only. Family roots are `<label>.eth`, registered for 1, 2 or 5 years and renewable from the tab, fee in MockUSDC (`MOCK_USDC`). Record keys and relation vocabulary as in the pocket-money plan (`alias`, `family.relation` ∈ son/daughter/spouse, `class`).
- `ens/src` is the source of truth for `ens-family/*`; run `node ens/scripts/sync-to-app.mjs` after changing it; `--check` must pass. `ens/src/issue.ts` must not import anything Node-only (it runs in the browser).
- App TS target ES2017: **no bigint literals** in app code or in `ens/src` (use `BigInt(…)`).
- English source strings via `t()`; Korean only in `app/src/i18n/ko.ts`.
- The server holds **no private key** for this feature and sends no transaction.
- Commit only touched files, one `git add <path>` at a time. Schema changes are pushed by a human (docs/deployment.md §3.6).

## Review Focus

1. **A name that is taken, in its grace period, or taken between typing and registering** → never a paid step on it: the four checks of F12 stop the run before the next approval, with suggestions that are themselves available.
2. **Resuming must not adopt someone else's name** (F13): a live check registers nothing but proves `ainmem` (owned by the deployer) is `taken`, not `ours`, from grandma's wallet.
3. **The mapping can only point at a name the admin owns.** `POST …/ens` saves `workspace_ens` only when `findExactOwner(<root>) == callerWallet` and the root's subregistry grants the caller all roles. Anything else → 422, nothing saved.
4. **Wallet link conflicts:** the address already belongs to another account → 409 "This wallet is already used by another account" (no merge, no takeover); the account already has a different wallet → 409; a signature for another address or a stale/reused challenge → 401.
5. **MetaMask on the wrong account or chain, a rejected approval, a closed tab between commit and register** → the panel stops with a plain message ("Switch MetaMask to 0x12…ab", "Cancelled — press Continue"), and Continue resumes from the saved secret and addresses; a commit older than the registrar's maximum age is redone.
6. **The family name expires or is about to** → the tab shows a banner from 30 days before expiry ("lee.eth expires on 2027-09-26 — renew it or every name below stops working"), a red one in the grace period with the days left, and Renew works in both. After the grace period the name is `free` again: the tab says so and offers to register it again (the same flow as Create, which resumes on the existing registry because the contracts are ours).
7. **A label that is too long, uppercase, or has spaces/emoji** → rejected before any request, via `checkLabel`. Labels shorter than 3 characters are refused (`.eth` minimum) with suggestions.

---

## File Structure

| File | Responsibility |
|---|---|
| `ens/src/labels.ts` (new) | Pure: validate and normalize a label, suggest alternatives |
| `ens/src/availability.ts` (new) | Reads: `ethNameStatus`, `subnameStatus`, `holdsAllRoles` (the uniqueness rules F11–F15) |
| `ens/src/issue.ts` (new) | Wallet-agnostic writes: `deployFamilyContracts`, `registerEthName`, `registerPerson`, `addMember` (resumable, each tx reported through a callback) |
| `ens/src/abi.ts` (modify) | `MIN_COMMITMENT_AGE`, `MAX_COMMITMENT_AGE`, `commitments`, the role check |
| `ens/checks/family.check.ts` (modify) | Checks for `labels.ts` |
| `ens/scripts/live-check.ts` (modify) | Read-only uniqueness checks against live names |
| `ens/scripts/setup-family.ts` (modify) | Use `issue.ts` instead of its own copy |
| `app/src/lib/db/schema.ts` (modify) | `workspaceEns` table |
| `app/src/lib/ens-workspace.ts` (new) | Server: mapping get/set, reservations, `familyChainFor(workspaceId)` |
| `app/src/lib/ens-chain.ts`, `app/src/lib/agent/send-by-name.ts`, `app/src/app/(app)/send/page.tsx`, `app/src/app/api/ens/send/confirm/route.ts`, `ens/src/send-token.ts` (modify) | Use the workspace's family (F10) |
| `app/src/app/api/auth/wallet-link/route.ts` (new) | Attach a verified MetaMask address to the signed-in user |
| `app/src/lib/wallet/metamask-login.ts` (new) | `signChallengeWithMetaMask`, `signInWithMetaMask`, `linkMetaMask` — shared by login and settings |
| `app/src/components/login-form.tsx` (modify) | Call the shared helper (no behaviour change) |
| `app/src/app/api/workspaces/[workspaceId]/ens/route.ts` (new) | `GET` state and availability; `POST` save the mapping after verifying ownership onchain |
| `app/src/app/api/workspaces/[workspaceId]/ens/reserve/route.ts` (new) | Hold a family label for 30 minutes inside the app (F14) |
| `app/src/lib/wallet/ens-issue.ts` (new) | Browser: MetaMask `WalletClient` + account/chain guard, then calls `issue.ts` |
| `app/src/components/settings/family-names-panel.tsx` (new) | The tab: connect gate, availability + price, create flow, renew, step list |
| `ens/src/tree-layout.ts` (new) | Pure: where each card of the family tree goes (generations as rows, spouses beside, ghost cards) |
| `app/src/components/settings/family-tree-canvas.tsx`, `family-person-card.tsx`, `add-member-card.tsx` (new) | The tree canvas: person cards, ghost "+ Add" cards that open into the form, pending → settled cards |
| `app/src/components/settings/settings-modal.tsx` (modify) | `"family"` tab in the Workspace group |
| `app/src/i18n/ko.ts` (modify) | Korean for every new key |

---

### Task 1: Label rules (pure)

**Files:** Create `ens/src/labels.ts`; modify `ens/checks/family.check.ts`.

**Interfaces — Produces:** `checkLabel(input: string, opts?: { min?: number }): { ok: true; label: string } | { ok: false; reason: "empty" | "too-short" | "too-long" | "invalid" }`; `suggestLabels(base: string, n?: number): string[]` (candidates only; availability is checked by the caller).

- [ ] **Step 1: Failing checks** (insert above the summary lines):

```ts
import { checkLabel, suggestLabels } from "../src/labels";
// ── labels ──────────────────────────────────────────────────────────────────
ok("label: plain", same(checkLabel("lee"), { ok: true, label: "lee" }));
ok("label: trimmed + lowercased", same(checkLabel("  Lee "), { ok: true, label: "lee" }));
ok("label: spaces become hyphens", same(checkLabel("Lee family"), { ok: true, label: "lee-family" }));
ok("label: empty", same(checkLabel("   "), { ok: false, reason: "empty" }));
ok("label: .eth minimum", same(checkLabel("li", { min: 3 }), { ok: false, reason: "too-short" }));
ok("label: subname may be short", same(checkLabel("jo"), { ok: true, label: "jo" }));
ok("label: too long", same(checkLabel("a".repeat(33)), { ok: false, reason: "too-long" }));
ok("label: emoji rejected", same(checkLabel("lee🙂"), { ok: false, reason: "invalid" }));
ok("label: dot rejected", same(checkLabel("lee.kim"), { ok: false, reason: "invalid" }));
ok("label: leading hyphen rejected", same(checkLabel("-lee"), { ok: false, reason: "invalid" }));
ok("suggest: family-style candidates", same(suggestLabels("lee", 4), ["lee-family", "the-lees", "lee2", "lee3"]));
```

- [ ] **Step 2:** `cd ens && npm run check` → FAIL (module not found).
- [ ] **Step 3: Implement**

```ts
// ens/src/labels.ts
// What may become one ENS label in a family tree: lowercase a–z, 0–9 and inner hyphens,
// 1–32 characters (3+ for a .eth name). Stricter than ENSIP-15 on purpose: families type these.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export type LabelCheck = { ok: true; label: string } | { ok: false; reason: "empty" | "too-short" | "too-long" | "invalid" };

export function checkLabel(input: string, opts: { min?: number } = {}): LabelCheck {
  const label = input.trim().toLowerCase().replace(/\s+/g, "-");
  if (!label) return { ok: false, reason: "empty" };
  if (label.length > 32) return { ok: false, reason: "too-long" };
  if (!LABEL.test(label)) return { ok: false, reason: "invalid" };
  if (label.length < (opts.min ?? 1)) return { ok: false, reason: "too-short" };
  return { ok: true, label };
}

/** Candidate labels to try when `base` is taken — the caller keeps only the available ones. */
export function suggestLabels(base: string, n = 6): string[] {
  const out = [`${base}-family`, `the-${base}s`];
  for (let i = 2; out.length < n; i++) out.push(`${base}${i}`);
  return out.slice(0, n);
}
```

- [ ] **Step 4:** `npm run check` → previous count + 11, 0 failed; `npm run typecheck` silent.
  - *Done 2026-09-26 (111 → 126):* four extra checks beyond the 11 above — `checkLabel("ab--c")` is `invalid` (a double hyphen is refused, like ENSIP-15's reserved `xx--` labels), and `suggestLabels` filters its candidates through `checkLabel`, so a 31-character base yields only `<base>2`, `<base>3`… instead of over-long `-family`/`the-…s` labels; `suggestLabels` normalizes its base first (`"Lee"` → `lee-family`) and returns none for an invalid base. `labels.ts` is synced to `app/src/lib/ens-family/labels.ts`.
- [ ] **Step 5: Commit** `ens/src/labels.ts`, `ens/checks/family.check.ts` — `feat: ens label rules for family names`.

---

### Task 2: Availability in the global registry

**Files:** Create `ens/src/availability.ts`; modify `ens/src/abi.ts`, `ens/scripts/live-check.ts`.

**Interfaces — Produces:**

```ts
export type NameStatus = "free" | "ours" | "taken";
// <label>.eth in the global registry (F11, F13). ours = owned by `me` (and, when given, its subregistry is `expectRegistry`).
export function ethNameStatus(pub: PublicClient, label: string, me?: Address, expectRegistry?: Address): Promise<{ status: NameStatus; price?: { base: bigint; premium: bigint } }>
// <label>.<parentName> under a family (F15). ours = resolver is `expectResolver` or owner is `expectOwner`.
export function subnameStatus(pub: PublicClient, input: { parentName: string; parentRegistry: Address; label: string; expectResolver?: Address; expectOwner?: Address }): Promise<NameStatus>
// Does `account` hold every root role on this registry/resolver?
export function holdsAllRoles(pub: PublicClient, contract: Address, account: Address): Promise<boolean>
// Up to `n` suggestions that are free right now (suggestLabels + ethNameStatus).
export function availableSuggestions(pub: PublicClient, base: string, n?: number): Promise<string[]>
```

Rules:
- `ethNameStatus`: `isAvailable(label)` true → `free` with `getRegisterPrice(label, 1 year, MOCK_USDC)`. False → `ours` when `findExactOwner(dnsEncode(label + ".eth")) == me` (and `ETH_REGISTRY.getSubregistry(label) == expectRegistry` if given), else `taken`.
- `subnameStatus`: taken when `findExactOwner(dnsEncode(full)) != 0` **or** `getResolver(label) != 0` on `parentRegistry` (a name registered with no resolver still has an owner); `ours` as defined above.
- `holdsAllRoles`: the role read of `EnhancedAccessControl` **as it is at contracts-v2@71a3b73** (expected `hasRootRoles(uint256 roleBitmap, address account)`; confirm the exact name and signature in the source before adding it to `abi.ts`).
- `abi.ts` also gets `MIN_COMMITMENT_AGE()`, `MAX_COMMITMENT_AGE()` and `commitments(bytes32) view returns (uint64)` from the ETHRegistrar at the same commit (confirm names in the source), and for renewal (verified in `IETHRenewer.sol` at 71a3b73): `renew((string label, uint64 duration, bytes32 referrer) rd, address paymentToken)`, `getRenewPrice(string label, uint64 duration, address paymentToken) view returns (uint256)`, `isRenewable(string label) view returns (bool)`, `getRemainingGracePeriod(string label) view returns (uint64)`, `event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)`; and `ETH_REGISTRY.getState(uint256 tokenId)` for the expiry (confirm the struct at the same commit).
- `ethExpiry(pub, label): Promise<{ expiresAt: number; inGrace: boolean; graceLeft: number } | null>` — the expiry for the banner and the tree header.

- [ ] **Step 1:** Implement `availability.ts` and the `abi.ts` entries.
- [ ] **Step 2: Live checks** (read-only, add to `ens/scripts/live-check.ts`):
  - `ethNameStatus("ainmem")` → `taken`; with the deployer as `me` → `ours`; with grandma as `me` → `taken` (F13).
  - `ethNameStatus("zz-<timestamp>")` → `free` with a non-zero `price.base`.
  - `ethNameStatus` of a well-known name registered outside this project on Sepolia v2 (pick one from app.ens.dev during implementation and record it) → `taken`.
  - `subnameStatus` `kim` under `ainmem.eth` → `taken`, `ours` with the kim family resolver; `minjun` under dad → `taken`; `zz-<ts>` under dad → `free`.
  - `holdsAllRoles(kimRegistry, deployer)` → true, `(kimRegistry, grandma)` → false.
  - `availableSuggestions(pub, "ainmem", 3)` → 3 labels, each `free`.
  - `ethExpiry("ainmem")` → about one year after its registration, `inGrace` false; `isRenewable("ainmem")` → true; `getRenewPrice("ainmem", 1 year, MOCK_USDC)` → non-zero.
- [ ] **Step 3:** `cd ens && npm run typecheck && npm run check && npm run live` (live green). `node scripts/sync-to-app.mjs`.
  - *Done 2026-09-26 (checks 126 → 141, live 3 → 24 lines, all ✓; nothing sent).* Confirmed at 71a3b73: the role read is `hasRootRoles(uint256,address)` (checked with `ALL_ROLES` = `0x1111…1111`, now in `config.ts`); the commitment mapping is **`commitmentAt(bytes32) → uint64`**, not `commitments`; `GRACE_PERIOD()` added (Sepolia: 28 days; MIN/MAX commitment age 60 s / 86400 s); `getState` returns `(uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource)` with status 0 AVAILABLE · 1 RESERVED · 2 REGISTERED, read on `ETH_REGISTRY` as `permissionedRegistryAbi`. Deviations: in the grace period `findExactOwner` and `getSubregistry` both read zero, so `ethNameStatus` returns `{ status: "ours", inGrace: true }` when `getState(...).latestOwner == me` and `getRemainingGracePeriod > 0` (owner match still required; the subregistry cannot be checked until renewed) — otherwise `taken`; with no `me` a non-free name is always `taken`. `ethExpiry` also reports a reserved name's expiry. Outside names used: `skip.eth` (registered by 0x8d4a…68B6) and `vitalik.eth` (RESERVED for the v1 migration) → both `taken`. `npm run live` now defaults to the kim demo (root, from-block, grandma) so it runs with no env. Fake-reader checks cover the grace/reserved/case paths.
- [ ] **Step 4: Commit** `ens/src/availability.ts`, `ens/src/abi.ts`, `ens/scripts/live-check.ts` and the synced copies under `app/src/lib/ens-family/` — `feat: ens availability — .eth names checked in the global registry, never adopted`.

---

### Task 3: Wallet-agnostic writes in `ens/src/issue.ts`

**Files:** Create `ens/src/issue.ts`; modify `ens/scripts/setup-family.ts`.

**Interfaces — Consumes:** `abi.ts`, `config.ts`, `availability.ts`, `dnsEncode`. **Produces:**

```ts
export interface TxStep { key: string; label: string; hash: Hex | null; status: "sent" | "confirmed" | "skipped" | "waiting" }
export interface IssueContext { wallet: WalletClient; pub: PublicClient; account: Address; onStep?: (s: TxStep) => void }
export class NameTakenError extends Error { constructor(public name: string) { super(`${name} is already taken`) } }
// The family registry (account holds ALL roles) and the family resolver (alias, class=Family).
export function deployFamilyContracts(ctx: IssueContext, input: { familyLabel: string; familyAlias: string }): Promise<{ registry: Address; resolver: Address; fromBlock: bigint }>
// <label>.eth through ETHRegistrar: mint + approve MockUSDC, commit, wait, register. `saved` carries the secret/commit time across reloads.
export function registerEthName(ctx: IssueContext, input: { label: string; registry: Address; resolver: Address; saved?: { secret: Hex; committedAt: number } ; onSave?: (s: { secret: Hex; committedAt: number }) => void }): Promise<{ name: string }>
// Extend <label>.eth by `years`: mint + approve MockUSDC when short, then renew. Any wallet may renew (F3).
export function renewEthName(ctx: IssueContext, input: { label: string; years: number }): Promise<{ newExpiry: bigint }>
// A person directly under a registry the account controls (the first person).
export function registerPerson(ctx: IssueContext, input: { parentName: string; registry: Address; label: string; alias: string; relation: Relation | null; address: Address; treeAddresses: Address[] }): Promise<{ resolver: Address }>
// A member under a person; deploys + links the person's subregistry first when missing.
export function addMember(ctx: IssueContext, input: { parentName: string; parentRegistry: Address; parentLabel: string; label: string; alias: string; relation: Relation; address: Address; treeAddresses: Address[] }): Promise<{ registry: Address }>
```

Rules (from the working setup script, commit 8acfb85 — move its helpers `send`, `deploy`, `newRegistry`, `newResolver`, the role constants, `FAR_EXPIRY`, `PARENT_DURATION` and the salt scheme into `issue.ts`, with `BigInt(…)` instead of literals):
- **Salts** include the sending account: `ainmem-family:<account>:<tag>`. Keep the old scheme behind `saltScheme: "legacy"` for the kim family.
- Every write is simulated before it is sent; each emits `onStep` (`sent`, then `confirmed`).
- **`registerEthName`**, in order, each step re-checking where F12 says:
  1. `ethNameStatus(label, account, registry)`: `ours` → emit all steps `skipped`, return; `taken` → throw `NameTakenError`.
  2. `getRegisterPrice`; if the MockUSDC balance is short, `mint(account, base + premium)`; if the allowance is short, `approve(ETH_REGISTRAR, base + premium)`.
  3. If `saved` is present and `commitments(commitment)` is non-zero and younger than `MAX_COMMITMENT_AGE`, skip the commit. Otherwise: secret = 32 random bytes (`crypto.getRandomValues`), `ethNameStatus` again (taken → throw), `commit`, `onSave({ secret, committedAt })`.
  4. Emit `waiting` until `MIN_COMMITMENT_AGE` has passed since `committedAt` (+ 5 s margin).
  5. `ethNameStatus` again (taken → throw), then `register(label, account, secret, registry, resolver, years * 365 days, MOCK_USDC, 0x0…0)` (`registerEthName` takes `years`, default 1).
- **`renewEthName`**: `isRenewable(label)` false → throw `NotRenewableError` (the caller offers to register again); `getRenewPrice`; mint/approve MockUSDC when short (same helper as registration); `renew({ label, duration: years * 365 days, referrer: 0x0…0 }, MOCK_USDC)`; read `newExpiry` from the `NameRenewed` log.
- **Resumable, never adopting (F13):** before registering a subname, `subnameStatus` with the expected resolver/owner: `free` → register; `ours` → `skipped` and read `getSubregistry(label)`; `taken` → throw `NameTakenError`. Before deploying a proxy, compute its CREATE2 address; if code exists there, `skipped`.
- `registerPerson`/`addMember` refuse an `address` already in `treeAddresses` (F15).
- `addMember` under a person with **no subregistry yet**: deploy one (account ALL roles), `setSubregistry(parentLabel, registry)` on the parent registry, then deploy the member's resolver (grants `ROLE_SET_ADDRESS` to the member's wallet) and register them with `roleBitmap = 0`, `FAR_EXPIRY`. 2 txs if the parent already has children, 4 otherwise.
- No Node imports (`fs`, `process`) in this file.

- [ ] **Step 1:** Implement `issue.ts` following the rules above.
- [ ] **Step 2:** Rewrite `setup-family.ts` to call these functions with the deployer as `account` and `saltScheme: "legacy"`. Run it against the existing kim family: every step must print `skipped`.
- [ ] **Step 3: One live `.eth` registration from the CLI** (ask the human first; costs ≈ 0.003 Sepolia ETH from the deployer): register `zz-<ts>.eth` with a throwaway family through `deployFamilyContracts` + `registerEthName`, interrupting once after `commit` (kill the process) and resuming with the saved secret — the resumed run must skip the commit and finish. Then `ethNameStatus("zz-<ts>", deployer)` → `ours`, with grandma → `taken`. Then `renewEthName("zz-<ts>", 1)` **from grandma's wallet** (anyone may renew, F3): `ethExpiry` moves by exactly one year.
- [ ] **Step 4:** `cd ens && npm run typecheck && npm run check`. `node scripts/sync-to-app.mjs`.
  - *Done 2026-09-26, nothing broadcast (run criterion).* Step 2: `ENS_SETUP_ADDRESS=<deployer> npm run setup-family -- demo-family.json` (plan-only, no key read) → 28 steps, all `skipped`, with the legacy salts. Step 3 replaced by `npm run simulate` (`ens/scripts/simulate-check.ts`): a recording `Sender` captures every write and the sequence is replayed with eth_simulateV1 (`simulateBlocks`), one block per commit wait — fresh family deploy + mint/approve/commit/register from the deployer, `aunt` under grandma (2 txs), a child under leaf `minjun` (4 txs), `minjun` under dad from grandma → `NameTakenError` with nothing recorded, `renewEthName("ainmem", 1)` from grandma (mint/approve/renew); a no-wait replay fails (negative control); deployer/grandma nonces unchanged. Fake-chain checks for the resume rules (141 → 156). Confirmed at 71a3b73: `setSubregistry(uint256 anyId, address)` (anyId = labelhash), VerifiableFactory CREATE2 = `keccak256(abi.encode(sender, salt))` over the salted EIP-1167 clone with `proxyLogic()` `0xC6db…Ad8E` (predictions match every kim proxy). Deviations: every write goes through a `Sender` (`walletSender(wallet, pub, account)` by default; `IssueContext.wallet` optional when `sender` is given) and `TxStep.status` adds `simulated`; a finished wait emits `confirmed` on its `waiting` row; `onSave` is also called **before** the commit is sent (a tab closed while it is pending keeps the secret), and a saved commitment is reused only if it can still be registered after the wait (`commitmentAt + MAX > now + MIN + 5`); a member counts as `ours` only by our CREATE2 resolver, never by owner (stricter F13); the ours/skip check runs before the `treeAddresses` refusal so a resume of an existing member works (`AddressInTreeError`); `deployFamilyContracts` takes an optional `familyName` (kim.ainmem.eth), refuses a taken `.eth` root before deploying, and returns `fromBlock: null` when both proxies existed (no archive `getCode` on public RPCs); `registerSubname` and `deployRegistry`/`deployResolver` are exported for the legacy parent/family path of `setup-family.ts`.
- [ ] **Step 5: Commit** `ens/src/issue.ts`, `ens/scripts/setup-family.ts` and the synced `app/src/lib/ens-family/issue.ts` — `feat: ens issue.ts — .eth family names and members from any wallet`.

---

### Task 4: Connect MetaMask to the current account

**Files:** Create `app/src/app/api/auth/wallet-link/route.ts`, `app/src/lib/wallet/metamask-login.ts`; modify `app/src/components/login-form.tsx`.

**Interfaces — Produces:**
```ts
// metamask-login.ts (client)
export function signChallengeWithMetaMask(): Promise<{ address: string; signature: string }>
export function signInWithMetaMask(displayName?: string): Promise<{ ok: true } | { ok: false; error: string }>   // → /api/auth/metamask-verify (unchanged behaviour)
export function linkMetaMask(): Promise<{ ok: true; address: string } | { ok: false; error: string; reason?: "taken" | "has-other" }>  // → /api/auth/wallet-link
// POST /api/auth/wallet-link  body { signature, address }
→ 200 { address } | 400 (missing fields) | 401 (not signed in / bad signature / no challenge) | 409 { reason: "taken" | "has-other" }
```

- [x] **Step 1: Shared helper.** Move `login-form.tsx:68-138` into `metamask-login.ts`: `signChallengeWithMetaMask` does the permission reset, `eth_requestAccounts`, `GET /api/auth/challenge` and `personal_sign` (with `toHexMessage`); `signInWithMetaMask` posts to `metamask-verify`; `linkMetaMask` posts to `wallet-link`. Same requests and error texts as today, no routing inside.
- [x] **Step 2:** `login-form.tsx` calls `signInWithMetaMask` and keeps its own `setBusy`, `setError`, `router.push("/")`, `router.refresh()`. Browser check: the login page's MetaMask button behaves as before (headless: "MetaMask not detected" appears exactly as before).
- [x] **Step 3: Route.**

```ts
// app/src/app/api/auth/wallet-link/route.ts
// POST /api/auth/wallet-link — attach a MetaMask address to the account that is signed in now.
// Same challenge and EIP-191 check as /api/auth/metamask-verify, but it never switches accounts:
// the session keeps its user and active workspace. One wallet belongs to one account.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const TAKEN = { reason: "taken", error: "This wallet is already used by another account." } as const;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { signature, address } = await req.json().catch(() => ({}));
  if (typeof signature !== "string" || typeof address !== "string") {
    return NextResponse.json({ error: "signature and address are required" }, { status: 400 });
  }
  const challenge = session.challenge;
  if (!challenge) return NextResponse.json({ error: "No challenge found. Please try again." }, { status: 401 });
  session.challenge = undefined; // one use, pass or fail
  await session.save();

  const { verifyEthSignature } = await import("@/lib/auth/eth-verify");
  const { challengeMessage } = await import("@/lib/auth/ain-verify");
  const valid = await verifyEthSignature(challengeMessage(challenge), signature, address).catch(() => false);
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const addr = address.toLowerCase();
  const [me] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (me.ainAddress === addr) return NextResponse.json({ address: addr });
  if (me.ainAddress) {
    return NextResponse.json({ reason: "has-other", error: "This account already has another wallet." }, { status: 409 });
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.ainAddress, addr)).limit(1);
  if (owner) return NextResponse.json(TAKEN, { status: 409 });
  try {
    await db.update(users).set({ ainAddress: addr }).where(eq(users.id, me.id));
  } catch {
    return NextResponse.json(TAKEN, { status: 409 }); // lost a race on the unique column
  }
  session.ainAddress = addr;
  await session.save();
  return NextResponse.json({ address: addr });
}
```

- [x] **Step 4:** Verify with a scratch script (random `viem/accounts` keys, a cookie jar, the dev server via `scripts/dev.sh`): demo user → challenge → sign → 200, `users.ain_address` set, `/api/me` returns the **same user id**; same wallet again → 200; another wallet → 409 `has-other`; a second demo user linking the first wallet → 409 `taken`; reused challenge → 401; wrong address for the signature → 401; signed out → 401. Delete the test rows afterwards.
- [x] **Step 5:** app `tsc` 0, eslint clean. **Commit** the three files — `feat: connect MetaMask to the signed-in account (wallet-link); login uses the shared helper`.

**Done 2026-09-26 — deviations from the code above:** `verifyEthSignature` is synchronous (returns a boolean, never throws), so the route calls it directly rather than `.catch`, and imports it statically. The update is `where id = me.id and ain_address is null` (zero rows → 409 `has-other`), so two concurrent links on one account cannot overwrite each other. `demo-login { as }` accounts carry the placeholder `demo:<slug>`, so the Step 4 script clears that on its own rows first; it also checks missing fields → 400 (9/9 pass).

---

### Task 5: Workspace ↔ family mapping

**Files:** Modify `app/src/lib/db/schema.ts`; create `app/src/lib/ens-workspace.ts`; modify `app/src/lib/ens-chain.ts`, `app/src/lib/agent/send-by-name.ts`, `app/src/app/(app)/send/page.tsx`, `app/src/app/api/ens/send/confirm/route.ts`, `ens/src/send-token.ts` (+ its checks).

- [ ] **Step 1: Table** (next to the other workspace tables):

```ts
// A workspace's family name in ENS (docs/superpowers/plans/2026-09-26-ens-family-settings.md).
// One per workspace; the tree itself lives onchain.
export const workspaceEns = pgTable("workspace_ens", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  rootName: text("root_name").notNull().unique(),
  fromBlock: text("from_block").notNull(), // decimal string; bigint-safe
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- [ ] **Step 2: Push the schema to the dev DB only** (the human delegated this on 2026-09-26; docs/deployment.md §3.6). From `app/` with the dev `POSTGRES_URL` (`localhost:5434`): run `drizzle-kit push`, read its diff, and apply it only if it is exactly the new `workspace_ens` table with its constraints — any drop or change to another object aborts the push and is reported. Then `pnpm db:check` exits 0. The xyz and prod DBs are **not** pushed; the hand-off says they need it before this ships there (the xyz auto-deploy rolls back on a 503 until then).
- [ ] **Step 3: `ens-workspace.ts`** (server-only): `getWorkspaceFamily(workspaceId): Promise<{ rootName: string; fromBlock: bigint } | null>`; `setWorkspaceFamily(...)` (unique violation → `"exists"`); `familyChainFor(workspaceId): Promise<FamilyChain | null>` (mapping first, then the env root — F10; one cached `FamilyChain` per root; `forgetFamilyChain(root)` drops the cache after writes); reservations `reserveLabel(label, workspaceId): "ok" | "reserved"`, `reservedByOther(label, workspaceId): boolean`, `releaseLabel(label)` — a `globalThis` map, entries expire after 30 minutes (F14).
- [ ] **Step 4:** Add `workspaceId` to `SendIntent` in `ens/src/send-token.ts` (update its checks, re-sync) and replace `familyChain()` in `send-by-name.ts`, `/send/page.tsx` and the confirm route with `familyChainFor(workspaceId)`. Keep `familyChain()` exported for the env fallback.
- [ ] **Step 5:** app `tsc` 0, eslint clean, `sync --check` in sync, ens check green; the kim demo still answers "send Minjun 1 USDC" in grandma's panel.
- [ ] **Step 6: Commit** by path — `feat: workspace family names — mapping table, reservations, per-workspace family chain`.

---

### Task 6: Family API (reads, reservation, mapping)

**Files:** Create `app/src/app/api/workspaces/[workspaceId]/ens/route.ts`, `app/src/app/api/workspaces/[workspaceId]/ens/reserve/route.ts`.

**Shapes:**

```ts
// GET /api/workspaces/[id]/ens  (any member)
{ me: { address: string | null; canEdit: boolean },
  family: null | { root: string; registry: string; expiresAt: string; tree: TreeNode },
  candidates: { userId: string; displayName: string; address: string }[] }   // workspace members with a linked wallet, not yet in the tree
// TreeNode = { name; label; alias; relation; address; registry: string | null; children: TreeNode[] }

// GET /api/workspaces/[id]/ens?label=lee
→ { status: "free" | "taken" | "reserved" | "invalid", reason?, price?: { usdc: string }, suggestions: string[] }
//   ethNameStatus + the reservation map; suggestions from availableSuggestions (each free right now)
// GET /api/workspaces/[id]/ens?parent=<name>&label=minjun   → same shape via subnameStatus (member form)

// POST /api/workspaces/[id]/ens/reserve  (admin + linked wallet) body { familyLabel }
→ 200 { label, expiresAt } | 409 { reason: "taken" | "reserved" | "exists", suggestions } | 400 | 403 | 412

// POST /api/workspaces/[id]/ens  (admin + linked wallet) body { familyLabel, fromBlock }   — after the browser registered it
→ 200 { root } | 403 | 409 { reason: "exists" } | 412 { reason: "no-wallet" } | 422 { reason: "not-yours" }
```

- [ ] **Step 1: GET.** Membership check; tree from `familyChainFor` (add `registry` per node from the chain's walk; `expiresAt` of the `.eth` root); `candidates` = workspace members whose `users.ain_address` is not null and not in the tree; `canEdit` from `requireWorkspaceRole(…, "admin")`. Availability: `checkLabel(label, { min: 3 })` → `invalid`; `reservedByOther` → `reserved`; else `ethNameStatus`.
- [ ] **Step 2: Reserve:** auth → admin → wallet → workspace has no family (409 `exists`) → `checkLabel` → `ethNameStatus` is `free` (409 `taken` + suggestions) → `reserveLabel` (409 `reserved`). The panel calls this **before** the first MetaMask approval.
- [ ] **Step 3: Save mapping** (Review Focus 3): auth → admin → wallet → no family yet → `ethNameStatus(label, callerWallet)` is `ours` **and** `holdsAllRoles(ETH_REGISTRY.getSubregistry(label), callerWallet)` (422 `not-yours`) → `setWorkspaceFamily` (unique `root_name` → 409 `exists`) → `releaseLabel`.
- [ ] **Step 4: Checks (curl + a scratch script):** signed out → 401; non-admin → 403; admin without wallet → 412; `?label=ainmem` → `taken` with 3 suggestions that are each `free`; `?label=li` → `invalid` `too-short`; workspace A reserves `zz-<ts>` → B's `?label=zz-<ts>` → `reserved`, B's reserve → 409 `reserved`; saving `ainmem` as A's family → 422 `not-yours`; saving the `zz-<ts>` name from Task 3 Step 3 as a workspace whose admin is the deployer → 200.
- [ ] **Step 5:** app `tsc`/eslint. **Commit** — `feat: family names API — global availability, reservation, mapping only for names you own`.

---

### Task 7: The settings tab

**Files:** Create `app/src/lib/wallet/ens-issue.ts`, `app/src/components/settings/family-names-panel.tsx`; modify `app/src/components/settings/settings-modal.tsx`.

- [ ] **Step 1: `ens-issue.ts`** — `familyContext(expected: Address): Promise<IssueContext>`: `getWalletClient()`, `requestAddresses()`, refuse when the account ≠ the linked wallet (`WalletSignatureError("failed", "wrong-account")`, as `sendUsdcTransfer`), `ensureChain(SEPOLIA_CHAIN_ID)`, a Sepolia `PublicClient` over `NEXT_PUBLIC_SEPOLIA_RPC` (fallback: the public node); plus `sepoliaBalance(address)`.
- [ ] **Step 2:** `SettingsTab` gains `"family"`; the Workspace nav group gets `<NavTab id="family" … label={t("Family names")} />`; the tab renders `<FamilyNamesPanel workspaceId={workspace.id} />`.
- [ ] **Step 3: Panel states** (same visual language as `workspace-general-panel.tsx`):
  1. **No linked wallet** → "Family names live on Ethereum (Sepolia ENS). Connect MetaMask to this account to create or manage them." + **Connect MetaMask** (`linkMetaMask()`, then refetch). `taken` → "This wallet is already used by another account — pick another account in MetaMask."; `has-other` → "This account already uses 0x12…ab."
  2. **Wallet, no family, admin** → form: family name `[lee].eth` with a live check (debounced 400 ms): "✓ lee.eth is available · 5 USDC (test) / year", "lee.eth is taken" + suggestion chips, "Someone in this app is registering this name right now" for `reserved`. Then the period (1 / 2 / 5 years, price updates), family display name, your name in the family `[grandma]` + your display name. A summary: "About 8 approvals in MetaMask and a 1-minute wait · you need ≈ 0.004 Sepolia ETH (you have 0.005)" and the yearly renewal note (F3). Under the ETH needed → faucet link, button disabled. Create stays disabled until the status is `free`; pressing it reserves the label first (F14).
  3. **Running** → step list: "Deploy family registry" → "Deploy family resolver" → "Get test USDC for the fee" → "Allow the fee" → "Reserve lee.eth (commit)" → "Waiting 60 s so nobody can snipe the name" (countdown) → "Register lee.eth" → "Deploy your resolver" → "Register grandma.lee.eth" → (server) "Link lee.eth to this workspace". Each: "Approve in MetaMask…" → spinner → ✓ with an Etherscan link; `skipped` muted. `NameTakenError` at any step → "lee.eth was just registered by someone else. Nothing more will be charged." + fresh suggestions. A rejected approval → "Cancelled — press Continue to pick up where you left off." (F9 saved state).
  4. **Family exists** → header `lee.eth` with "Expires 2027-09-26", **Renew** and "Open in ENS app" (`https://app.ens.dev/<root>`). Renew opens a small form: 1 / 2 / 5 years, the price from `getRenewPrice`, "1–3 approvals in MetaMask"; it runs `renewEthName` with the same step list and refreshes the expiry. The Review Focus 6 banners sit above the header. Renew is shown to every member with a linked wallet, not only admins (anyone may renew onchain, and keeping the family working should not wait for the admin); then the **family tree canvas** (Task 7b), where members are added.
  5. **Not admin** → the canvas without ghost cards, with "Only workspace admins can change family names."
- [ ] **Step 4:** app `tsc`, eslint; `/browse` screenshots of states 1, 2 (with `taken`, `free` and `reserved` examples) and 5. States 3–4 need MetaMask: Task 8.
  - *Done 2026-09-26, nothing broadcast.* States 1, 2 (taken `ainmem`, invalid `li`, a free label), 4 (kim, source "default") and 5 screenshotted on dev 3110; with a recording EIP-1193 provider, Create holds the label and hands `deployProxy` on the VerifiableFactory to the wallet, whose rejection shows "Cancelled — press Continue". Deviations: the run orchestration (`runCreateFamily`, `runRenew`, saved run) lives in `ens-issue.ts`; `DELETE …/ens/reserve` releases the hold on Cancel / taken; the env fallback family (source "default") is shown read-only as "Demo family" while admins still get the create form; the tree is a plain list until 7b; after the grace period the tab shows a "free again" banner but re-registering a mapped name is not wired yet (POST …/ens refuses a workspace that already has a mapping).
- [ ] **Step 5: Commit** — `feat: settings — family names tab: connect MetaMask, register the family .eth, renew`.

---

### Task 7b: The family tree canvas — adding a child is watching a branch grow

The demo's second scene: under Grandma's card, a dotted "+ Add a child" card; pressing it turns that card into the form in place; while MetaMask approvals go through, the new card fills in from dotted to solid; at the end the card proves the subname works by resolving it live. Chosen over an indented list and a name-centred view (2026-09-26).

**Files:** Create `ens/src/tree-layout.ts` (pure; synced), `app/src/components/settings/family-tree-canvas.tsx`, `app/src/components/settings/family-person-card.tsx`, `app/src/components/settings/add-member-card.tsx`; modify `ens/checks/family.check.ts`, `app/src/components/settings/family-names-panel.tsx`.

**Interfaces — Produces:**

```ts
// ens/src/tree-layout.ts — where each card goes; no DOM, so it is checked like the rest of ens/.
export interface LaidOutCard { key: string; kind: "person" | "ghost-child" | "ghost-spouse"; node?: TreeNode; parentName?: string; row: number; col: number }
export interface LaidOutEdge { from: string; to: string; kind: "child" | "spouse" }
export function layoutFamily(tree: TreeNode, opts: { ghosts: boolean }): { cards: LaidOutCard[]; edges: LaidOutEdge[]; rows: number; cols: number }
```

**Layout rules** (`layoutFamily`):
- One row per generation, top-down. Onchain a spouse is a child node of their partner (`relation=spouse`); on the canvas the spouse sits **beside** the partner in the same row, joined by a short horizontal `spouse` edge, and **not** counted as a generation.
- Children (`son`/`daughter`) sit in the next row, centred under their parent (under the couple when there is a spouse); siblings keep label order.
- With `ghosts`: every person gets a `ghost-child` card as the last child; a person with no spouse gets a `ghost-spouse` card beside them — except spouses themselves (a spouse's children go under the couple, so the ghost-child of a couple belongs to the blood-line partner, whose registry holds the children).
- Columns are in card widths and may be half-integers (leaf-first packing: leaves take consecutive integer columns; a single parent sits at the mean of its children's columns; a couple's midpoint sits there, so partner and spouse are at mean ∓ 0.5). The component only multiplies by a card width; no overlap.

**Card states** (`family-person-card.tsx`, `add-member-card.tsx`):
- **Person, done:** alias (large), full name in small mono (`dad.grandma.lee.eth`, wrapping at dots), relation badge, short address, ✓. Click → a popover with "Resolves to 0x4C63…648C" (read live through the Universal Resolver when opened), Etherscan link for the address, "Open in ENS app".
- **Ghost:** dotted border, "+ Add a child" / "+ Add spouse", muted; only for admins.
- **Form (the ghost opened in place):**
  - **Who:** a picker of workspace members who have a linked wallet and are not in the tree (avatar + display name + short address), or **Paste an address** (`0x…` validated). Wallet-less people cannot be added (decision 2026-09-26); the picker's empty state says "Only people who connected MetaMask can be added. Ask them to open Settings → Family names and press Connect MetaMask."
  - **Name, built live in the card:** `[aunt].grandma.lee.eth` — the typed label in an input, the rest (the parent's full name) fixed after it; prefilled from the picked person's display name via `checkLabel`; availability under the parent via `?parent=&label=` (debounced 400 ms): "✓ available" / "taken" + suggestions.
  - **Relation:** son / daughter toggle (ghost-child); spouse is implied (ghost-spouse).
  - **Cost line:** "2 approvals in MetaMask", or for a parent's **first** child "4 approvals — the first child also creates Grandma's branch" (`addMember` deploys and links the parent's subregistry).
  - F15 notes: an address already in the tree is refused ("0x12…ab is already Minjun in this family"); an alias equal to another shows "the agent will ask which one when sending".
  - **Add** / **Cancel**.
- **Pending (after Add):** the card keeps its place with a dotted border, the edge to its parent is drawn dashed, a ring counts approvals ("◐ 2/4"), and the current step reads under the name ("Approve in MetaMask…", "Creating Grandma's branch…", "Registering aunt.grandma.lee.eth…"). While the first child creates the branch, the parent's card shows a small "branch" badge. Clicking the ring opens the step list with Etherscan links (same `TxStep` list as the create flow).
- **Settling:** on the last receipt the border turns solid, the edge solid, a short highlight (≤ 600 ms, none under `prefers-reduced-motion`), then the card re-resolves its own name through the Universal Resolver and shows "✓ resolves to 0x…" — the proof that the subdomain is live, not just a sent transaction. Then the panel refetches the tree (`forgetFamilyChain` on the server side of the GET).
- **Failure:** rejected approval → the card stays dotted with "Cancelled · Continue"; `NameTakenError` → back to the form with the label marked taken and suggestions; wrong account/chain → the Review Focus 5 message on the card.

**Canvas** (`family-tree-canvas.tsx`): absolutely positioned cards from `layoutFamily` (`left = col * (CARD_W + GAP)`, `top = row * (CARD_H + VGAP)`), one SVG behind them for edges (orthogonal lines: down from the parent/couple midpoint, across, down to each child). The canvas scrolls inside its own box (`overflow: auto`), never the page; opening a form scrolls that card into view. Under 640 px wide, rows stack as an indented list using the same cards (no SVG).

- [ ] **Step 1: Failing layout checks** in `ens/checks/family.check.ts`, on the kim tree shape (grandma → dad → {mom (spouse), minjun (son), seoyeon (daughter)}):

```ts
import { layoutFamily } from "../src/tree-layout";
// ── tree layout ─────────────────────────────────────────────────────────────
const kimTree = node("grandma", null, [node("dad", "son", [node("mom", "spouse", []), node("minjun", "son", []), node("seoyeon", "daughter", [])])]);
const plain = layoutFamily(kimTree, { ghosts: false });
const at = (k: string) => plain.cards.find((c) => c.key === k)!;
ok("layout: generations are rows", at("grandma").row === 0 && at("dad").row === 1 && at("minjun").row === 2);
ok("layout: spouse beside partner, same row", at("mom").row === at("dad").row && Math.abs(at("mom").col - at("dad").col) === 1);
ok("layout: spouse edge", plain.edges.some((e) => e.kind === "spouse" && e.to === "mom"));
ok("layout: children under the couple", (at("minjun").col + at("seoyeon").col) / 2 === (at("dad").col + at("mom").col) / 2);
ok("layout: no two cards share a cell", new Set(plain.cards.map((c) => `${c.row}:${c.col}`)).size === plain.cards.length);
const g = layoutFamily(kimTree, { ghosts: true });
ok("layout: ghost child under grandma", g.cards.some((c) => c.kind === "ghost-child" && c.parentName === "grandma"));
ok("layout: no ghost spouse for a married person", !g.cards.some((c) => c.kind === "ghost-spouse" && c.parentName === "dad"));
ok("layout: no ghost child under a spouse card", !g.cards.some((c) => c.kind === "ghost-child" && c.parentName === "mom"));
ok("layout: ghosts do not overlap", new Set(g.cards.map((c) => `${c.row}:${c.col}`)).size === g.cards.length);
```

  (`node(label, relation, children)` is a small helper at the top of the section building a `TreeNode` with `name` = label joined to its ancestors.)
- [ ] **Step 2:** `cd ens && npm run check` → FAIL (module not found). Implement `tree-layout.ts` by the rules above → pass; `npm run typecheck`; sync to the app.
- [ ] **Step 3:** Build the three components and wire the canvas into state 4 of the panel.
- [ ] **Step 4: Look at it without MetaMask.** A workspace with no mapping falls back to `ENS_FAMILY_ROOT=kim.ainmem.eth`, so the canvas renders the live kim tree read-only. `/browse` screenshots at 1280 px and 390 px: as admin (ghosts visible), as a non-admin (none), the form opened under Grandma with the picker's empty state and with a pasted address, the name `[aunt].grandma.kim.ainmem.eth` showing "✓ available" and `[dad]…` showing "taken". A pending card and the settling state are rendered by temporarily feeding a fixed `TxStep` list through a dev-only query flag (`?familyDemoSteps=1`, removed before commit) — the screenshots go in the Task 8 record, the flag does not ship.
  - *Done 2026-09-26, nothing broadcast.* On a throwaway workspace mapped to kim.ainmem.eth whose admin holds the deployer address: ghosts only where the API's per-node `canAdd` is true (admin + wallet holds all roles on the registry the name is written into); Add under Grandma hands `deployProxy` on the VerifiableFactory to a recording wallet, whose rejection shows "Cancelled · Continue"; `ens/scripts/replay-check.ts` replays it as `eth_call` and simulates it with `register` on grandma's subregistry. Deviations: layout checks find cards by `node.label` (keys are full names, labels repeat); `layoutForest` lays out the root's children (the root is the family, shown in the header) and `ghostsFor` limits ghosts to `canAdd` people; the settling state and `?familyDemoSteps=1` were not built (settling needs a broadcast; the flag would not ship); member adds do not persist to localStorage (resume is onchain: CREATE2 + our resolver); shared helpers moved to `family-ui.ts`; `GET ?fresh=1` (admins) drops the cached tree after an add.
- [ ] **Step 5:** app `tsc`, eslint. **Commit** — `feat: settings — family tree canvas: add a child or spouse in place and watch the name go live`.

---

### Task 8: Korean and the end-to-end demo

- [ ] **Step 1:** Add every new English key to `app/src/i18n/ko.ts`; `node app/scripts/i18n-keys.mjs` lists none of this feature's keys.
- [ ] **Step 2: Demo run** (a human with MetaMask; the admin's wallet needs ≈ 0.005 Sepolia ETH): new workspace → Settings → Family names → Connect MetaMask → type `kim` (taken? try `ainmem` — taken, suggestions appear) → pick a free name, e.g. `lee` → Create (first person `grandma`) → add `dad` (son) under grandma, `minjun` (son) under dad → assistant panel → "send Minjun 1 USDC" → 💸 Review and send → pay → Minjun's inbox shows "Grandma sent you pocket money".
- [ ] **Step 3:** Record the run (tx hashes, names) in `ens/plan-family-namespace.md` under "Demo run", and commit.

## Open decisions (later)

1. **Inviting a member while adding them** (F8). Today a member is picked from the workspace members with a linked wallet, or entered as an address, and nobody is told. Options: (a) also send a workspace invite to an email typed in the form; (b) an inbox notification when the member already has an account; (c) leave it as is. Not needed for the demo; decide before Task 7 if it should be in the first version.
2. **Reminding before expiry outside the tab** (F3). The tab shows the banners; an inbox notification to the admins 30 and 7 days before expiry would reach people who never open settings. Not needed for the demo.
