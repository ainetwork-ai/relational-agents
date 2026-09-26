# Relation Treasury — World Bounty Scenario (for team sharing, confirmed 2026-09-25)

> **Slogan**: AI manages the money. Humans approve it.
> **One sentence**: A Relation Agent manages a shared wallet, while World ID enables
> verified humans to authorize critical financial actions.
> **Three pillars**: World ID = proof of humanity · Relation Agent = understands relationships and permissions · Multi-approval = protects shared assets

## 1. Track names

- **[Continuity] Best Use of World ID for Agents** — $2,500
- **[Continuity] Best IDKit Use Case** — $2,500 (applying to both with the same demo)
- (Possible tie-in) Uniswap Foundation — if the investment scene uses a swap

## 2. Track requirements → how we meet them

| Requirement | How we meet it |
|---|---|
| Integrate the official dev environment (sandbox.auth.world.org, mock proofs) | OIDC (authorization code + PKCE), pairwise `sub` bound to the member |
| Full journey: request → human completes → verification → protected action | Chat command → agent classifies it as a protected action → World verification → quorum → on-chain execution |
| Rejection/failure paths (protected action not executed) | ① Solo large withdrawal BLOCKED ② Approval from a secondary account (same sub) invalid ③ Unverified member rejected |
| Backend verification, no secrets exposed | Tokens verified in the server callback, sub stored. Client responses are never trusted |
| Integration debrief | Submitted as a document (time-to-success, friction, one improvement) |
| (IDKit) Explain why the credential is minimal and sufficient | No name or identity needed — only "one unique human, one approval" → Proof of Human is minimal and sufficient |

## 3. Demo scenario (3 minutes, "Tokyo Trip travel club")

The agent is not a bot that only knows the balance but **an agent that knows the rules of the relationship**:

```
Relation: Tokyo Trip · Members: A B C D E · Dues: ₩100,000/month
Rules:  Spending under ₩100,000        → Agent executes automatically
        Spending ₩100,000 or more      → 2 verified humans approve
        Investing/asset management     → 3 approvals
        Withdrawing over 30% of assets → 4 approvals
        Transfer to a personal wallet  → cannot be approved by that person alone
```

1. **Creation** — 5 people create the travel-club room and each verifies with World (✓ Verified Human ×5) → a Relation Agent + shared wallet are created, and monthly dues are managed automatically
2. **Normal spending** — "Send the ₩800,000 hotel deposit" → the rules require 2 approvals → A and B verify with World → executed, recorded in the ledger
3. **Bad-actor scene (climax)** — A: "Send the ₩4,000,000 in the shared wallet to my wallet" → ⚠️ moving 80% of assets = 4 approvals required → only A verifies → **BLOCKED**. The agent explains why in natural language ("The rules require approval from 4 verified members, and there is currently 1"). Variant: trying to inflate the approval count with a secondary account → detected as the same human (sub collision), invalid
4. **Investment** — "Use the remaining money to reach the hotel-upgrade goal" → the agent proposes a swap strategy based on the relationship's objective (hotel cost of $1,150 by 10/3, low risk) → 3 approvals → executed (safely on a fork) → $1,000→$1,180
5. **Ending** — goal reached, hotel booked. *"We didn't just manage a wallet. We managed a relationship."*

## 4. Why World ID (pre-empting the judges' Q&A)

- **"Wouldn't wallet signatures do?"** — Safe counts keys. In the agent era, a key signature = an agent signature, so "3 approvals" could be one person's 10 wallets. A pairwise sub counts **humans**, not accounts, which restores the meaning of a quorum. *Wallet proves ownership. World proves humanity. Relation Agent connects the two.*
- **"Why do you need an agent?"** — Group bookkeeping is labor (collecting, chasing, keeping the books, settling up), and a single treasurer is a single point of failure (embezzlement, disappearing). The agent does the labor; humans hold the authority.
- **"Why a wallet?"** — Separating wallet ownership (the agent) from human authority (World ID) is the invention of this design. Human → World Verification → Relation Membership → Agent Authorization → Wallet → Transaction.

## 5. Implementation plan v2 (reviewed 2026-09-25 — reflects the more concrete story)

### Design principles (derived from the story)

- **Not a separate app.** Relation Agent = a new capability of the existing product, connecting AINmem (memory/rules) + AINDrive (data/permissions, P2) +
  Wallet (shared assets). The hackathon demo and the product architecture are the same.
- **Policy is not a settings screen but the relationship's memory.** Treasury Rules live as a
  section of the relationship document (OKF), and the agent reads it, quotes it, and decides from it —
  *"I know who we are, what our relationship is, and what we agreed to."*
  But **enforcement is deterministic code**: the rules table in the document is parsed into a typed policy, and code compares
  the quorum and limits. The LLM only classifies commands and explains the reasons (parse failure = refusal to execute by default).
- **Blocking has two layers**: ① Policy violation (e.g., personal withdrawals not allowed) → rejected without even requesting approval, with an explanation
  quoting the memory ② Allowed but large action → not executed if quorum is not met. Situation ② in the demo stars layer ①.
- **Every decision becomes memory again**: approvals, executions, and rejections are recorded in the relationship document (Treasury Activity) and
  the ledger dashboard — AINmem is the relation's financial memory.

### Continuity assets (re-survey result — far more than we thought)

| What already exists | Where | Review correction |
|---|---|---|
| **World ID integration (July)**: IDKit v4 server verification, verify-button UI, per-person nullifier binding at consent, on-chain Sybil guard | `lib/worldid.ts`, `components/dm/world-id-button.tsx`, `api/worldid/verify`, `contracts/*` | ⚠️ The dev-simulator path is **not** IDKit (a server-made nullifier) — for judging we need a Portal staging app + the official simulator for real proofs |
| Agent wallet infrastructure (spend/agentkit, sepolia, native transfer + funding top-up) | `lib/agent/agentkit.ts`, `spend.ts` | ⚠️ **Key issuance was removed in the 8/3 commit** (`provision.ts`) — must be restored; ERC20 is not implemented, so **use ETH native** |
| Room/member/chat/agent pipeline + OKF memory and source citation, **precedent for a deterministic skill matcher** ("money commands are sentences, not the model") | `lib/agent/respond.ts:385`, `family-skills.ts` | Treasury classification goes right next to `matchFamilySkill` |
| Multi-account demo login (member switching), **consent-banner** (per-member badge + verify button + polling) | PR #5, `components/dm/consent-banner.tsx` | Approval UI is a clone of consent-banner. ~~agent dock~~ (excluded — it is a personal assistant panel) |
| Ledger dashboard widgets (±colored counters/charts), watcher pattern, notifications (`notifyConsent`) | 1inch stage, `lib/notifications.ts` | |

→ **Continuity narrative**: "In July we asked for proof of humanity at the agent's *birth* (nullifier binding at
consent). This weekend we ask the same question at *every moment money moves* —
with World's new IdP (for Agents) and fresh multi-approval."

### Two tracks = two verification surfaces, one product

- **IDKit track**: in-app approve button = reuse the existing `world-id-button`/verify path, a **new moment
  of trust** (action `treasury-approval`, a nullifier per approval). The minimal-and-sufficient credential argument as-is.
- **Agents track**: the new sandbox IdP (OIDC step-up) — challenge in the agent flow → World
  verification → pairwise sub verification → protected action. (P1: step-up challenge on the treasury tool in notion-mcp
  — the same structure as the workshop demo, in our MCP.)

### Design decisions settled by review (night of 2026-09-25, 3-agent cross-review)

- **Approval = a fresh ceremony per action, not a lookup of a stored value.** "Bind worldSub once, then
  count" is the "bolt-on login" the track rules out. The identifier of an approval act is the **IDKit nullifier
  (action `treasury-approval`, signal=actionId)**; `users.worldSub` (IdP) is for the membership
  badge and account-level human binding. The IdP surface enforces a `max_age=0` + `auth_time` window.
- **Fixed surface↔moment mapping**: in-app member approval = IDKit (a person in front of the screen) / step-up issued by the
  agent = IdP (summoning an absent human). Stated in the demo and README. The approval card is **posted by the agent in the
  chat** (so the agent is seen as the one issuing the challenge).
- **Sybil scene = rejection at binding time**: render a `worldSub` unique violation (23505) as a card saying "this human already has
  a vote in this relationship". Duplicate approvals are naturally blocked by unique(actionId, approverKey). Right after registration,
  **top-priority test**: the mock identity's behavior in both directions (same human / different human).
- **Classification by regex, enforcement by SQL**: `matchTreasuryCommand()` next to `matchFamilySkill`
  (the `respond.ts:385` seam, the "money commands are sentences" precedent). Execution is atomic via
  `UPDATE … WHERE status='pending' RETURNING`. The approval POST accepts only `{actionId}`, and the server
  decides approverKey — a client payload never grants authority.
- **Rules use bullet syntax** (`- ₩100,000 or more: 2 approvals`) — md tables evaporate in `readOkfSectionTexts`.
  The Treasury Rules section is not added to the profile menu (to keep the recording LLM's appends from polluting it);
  the seed creates the file and registers it directly in `sectionOkfPaths`. Parse failure = refusal to execute.
- **Wallet**: after restoring agent key issuance (removed 8/3), **sepolia ETH native transfers only**
  (ERC20 not implemented). Fund and check balances tonight; pre-record the on-chain scene.
- **Confirmed cuts**: Uniswap swap, MCP step-up (arithmetically impossible in 37h — described as a design in the debrief;
  the only stretch goal if we are ahead by noon 9/26), agent dock integration, ERC20, credential tiering.
  **Must not cut**: the 4 rejection paths (policy violation / quorum not met / secondary-account binding rejected / unverified) — track requirement.
- **Debrief = a timestamped log from hour 0** → one each for IDKit/IdP. Commit each unit of work immediately
  to the submission repo (origin=relational-agents, confirmed).

### v3.1 (settled when implementation started, 2026-09-26 00:10) — surface↔moment reassignment

We kept the review consensus ("fresh per action", "fixed surface mapping") but flipped **which surface handles which moment**
to match the track wording:

- **Approval (right before the agent moves money) = World ID for Agents IdP step-up** — the Agents track
  wording is exactly "fresh verification at the moment", and the event's official resource is the sandbox
  IdP (`sandbox.auth.world.org`). `max_age=0` + `prompt=login`; the server verifies JWKS, nonce, and
  `auth_time ≥ action.createdAt`; quorum = DISTINCT pairwise subs per action.
  A second account of the same human = the same sub → invalid (`treasury_approvals` unique).
- **Earning a vote (the right to approve) = IDKit Proof of Human** — "fair access to a scarce right (a vote)",
  the minimal-and-sufficient credential argument as-is. signal=roomId, `treasury_seats(room, nullifier)` unique →
  one human, one vote (IDKit's alternative path "ineligible user").
- **IDKit v4 real-mode requirements (checked in the docs)**: the server signs rp_context for every request
  (`signRequest` @worldcoin/idkit-core/signing, with the Portal's RP signing key); verification forwards the result as-is to
  `developer.world.org/api/v4/verify/{rp_id}`; testing uses
  `environment="staging"` + simulator.worldcoin.org. The July code's static rp_context and v2
  verify are not valid in v4 → port the vote-earning path to v4 (follow-up after the build).
- **Values we need from the Portal**: `app_id`, `rp_id`, the RP signing key, registration of action `treasury-seat`
  (even after the UI label changed from seat → vote, the action id stays exactly as registered in the Portal —
  changing it breaks verification). **sandbox IdP**: client_id/secret, redirect
  `https://ainmem.ainetwork.ai/api/auth/world/callback`.
- Confirmed that the official docs' human-in-the-loop guide (IDKit approval + one-time consumption of `${action}:${nullifier}`) follows
  the same principle as our action-binding design — cite it in the debrief.

### P0 — confirmed execution order (~30h total, critical path = registration → deploy → real IdP verification → rehearsal)

0. **[Done] Immediate fixes** — manually applied `world_sub`/`world_verified_at`/`teamspace_drives.backup`
   to the dev DB (health back to 200), WIP commit. **[Waiting] Restore vLLM (:8100) or fall back via AI_URL** —
   all treasury messages are designed with template fallbacks, so the demo works without a model.
1. **One schema push** — `treasuryActions` (id·roomId·kind·params·paramsHash·
   requiredApprovals·status) + `treasuryApprovals` (actionId·userId·approverKey·
   unique(actionId, approverKey)), in **the same deploy unit** as worldSub.
2. **Mock IdP** (3 routes: authorize/token/jwks, `WORLD_ISSUER` swap, **supports "logging in with two accounts as the same
   human"**) → **callback** (checklist: requireAuth / state / **initiating-user cookie
   `world_uid`==session** (prevents mis-binding when switching via demo-login) / delete one-time cookies / 23505→rejection
   card / re-validate returnTo) + add nonce and `max_age=0` to connect.
3. **Restore wallet keys** (lazy, reviving the spend.ts path) + funding.
4. **Treasury Rules seed** (bullet syntax) + deterministic parser (`lib/agent/treasury/policy.ts`).
5. **Classification + gate + rejection** (cards quoting memory, templates first) — only a one-line hook in shared files; new
   logic goes in new files under `lib/agent/treasury/` (to minimize conflicts with teammates working in parallel).
6. **Approval flow** — TreasuryApprovalBanner (consent-banner clone) + `notifyConsent` notification +
   IDKit verify (action whitelist `{relation-consent, treasury-approval}`) + quorum +
   atomic execution + Treasury Activity (OKF `appendOkfLines`)/ledger recording.
7. **The 4 rejection paths** + one e2e check.
8. **Complete the seed**: Tokyo Trip with 5 people (demo workspace members, unique displayName, consentAt
   stamp, note that an @agent mention is needed) + a 6th secondary account + 3 people pre-verified. Rebuild with `--reset`.
9. **Prod deploy #1** (morning of 9/26) → real IdP round-trip verification → dry run → **17:00 feature freeze**
   → deploy #2 → pre-record the 3 risky scenes (OIDC round trip / on-chain / Sybil) → video together with the live scenes (command → approval
   → execution, instant rejection of policy violations).

### P2 — product expansion (mentioned in docs only)

- AINDrive permission grants through the same approval flow ("the same policy for money and data"), x402, MCP step-up.

### W5 docs — demo script (3 minutes, hotel ending, including the live vs. pre-recorded layout) +
**2 integration debriefs** (based on the hour-0 log: time-to-success / 3 friction points / 1 biggest improvement) +
README (English, a table of pre-existing (July personhood) vs. built-this-weekend) + the form.

## 6. Remaining work & risks

- [ ] **(Human, tonight — hour-0 blocker)** ① Create a Developer Portal staging app + action
      `treasury-approval` (max verifications **unlimited**) — without this the IDKit track cannot
      demonstrate requirements 1, 2, and 4 (the dev-simulator is not IDKit) ② Register the sandbox IdP client
      (20-minute approval window, redirect=`https://ainmem.ainetwork.ai/api/auth/world/callback`).
      If registration fails there is no fallback for the Agents track — final deadline is the morning of 9/26.
- [ ] Restore vLLM / AI_URL fallback, sepolia funding (the agent, tonight)
- [ ] Record the demo video voice-over (human, evening of 9/26 — shoot in segments)
- Risks: deadline 09-27 09:00 JST. Deploys are limited to 2 (to avoid a deploy loop per bug — verify locally
  with the mock IdP first); if deploying is impossible, register an HTTPS tunnel as an additional redirect. Rehearsals must
  use localhost/HTTPS (on a LAN IP the Secure cookies are lost). IdP availability during judging is out of our control —
  the core of the submission is the video.
