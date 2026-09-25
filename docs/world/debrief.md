# Integration debriefs — World ID (ETHGlobal Tokyo 2026, Continuity)

Two surfaces, two debriefs, both built from the timestamped
[integration log](integration-log.md). Times of first success are filled in
from the log once the real services have answered; until then they read _TBD_
rather than an estimate. (The log's own note explains which of its early times
are approximate.)

## Why two surfaces

Each answers a different question at a different moment, and the treasury
needs both answers:

- **IDKit — "is this member one unique human?"**, once, when they claim a vote.
  The vote fixes the roster before any request exists: who is notified, whether
  enough people could ever reach a bar, and "one human, one vote" on the
  strongest uniqueness credential.
- **World ID for Agents — "is a unique human approving *this*, now?"**, on every
  critical action. The quorum counts distinct pairwise subs, each a fresh
  step-up made after the request.

Either alone falls short: step-ups alone would let any account holder's
approval count; a vote alone would let a hijacked session approve.

## 1 · World ID for Agents (sandbox IdP) — agent approvals

**Where it sits:** every critical treasury action the Relation Agent is about to
execute waits for fresh step-ups from distinct humans. Request (agent's card in
the room) → our confirmation page (amount, payee and address, requester, rule,
approvals so far) → user completion (IdP, `max_age=0`, `prompt=login`) →
validated result (server: JWKS signature, iss/aud/exp, nonce, `auth_time`
present and after the action was created, pairwise `sub`) → protected action
(the agent's on-chain transfer, after re-checking the rules and balance in force
at that moment), counted by DISTINCT subs per action. Denied paths: cancelled at
the IdP, same human from a second account, member without a vote, stale proof,
expired request, policy violation (refused before any approval is requested).

- **Time to first success:** _TBD from log_ (discovery → first validated id_token
  from the sandbox; so far only the local mock has answered)
- **Friction:**
  1. Client registration is interactive (portal login, 20-minute approval
     window) and HTTPS-only redirects, so localhost cannot iterate; we built a
     local mock with the same discovery shape to develop against.
  2. Freshness semantics are undocumented: whether `max_age=0` / `prompt=login`
     force a re-verification in the sandbox, and whether `auth_time` is always
     present. We fail closed — an id_token without `auth_time` counts as a stale
     proof — so if the sandbox omits it, approvals will say so rather than pass
     on `iat`.
  3. The docs page for World ID for Agents lists no endpoints; we read
     `/.well-known/openid-configuration` directly. It advertises three token
     endpoint auth methods but not which one a registered client gets, so the
     method is pinned by configuration (`WORLD_TOKEN_AUTH_METHOD`).
- **Missing capability / docs:** the step-up cannot say what is being approved —
  the IdP screen is the same for "verify your account" and "approve $180 to the
  hotel", so the relying party has to show the action itself before sending the
  user there (we added a confirmation page for exactly that). Docs: an endpoint
  list and the freshness guarantees above.
- **The one improvement with the greatest impact:** let the step-up request
  carry an authorization detail — what is being approved, e.g. RFC 9396
  `authorization_details` or a signed claim — shown on the IdP screen and echoed
  in the id_token. The human would then see the action at the moment of proof,
  and a relying party wouldn't have to bind "which action" itself through
  state/nonce, cookies and time windows.

## 2 · IDKit — claiming a vote in the treasury

**Trust moment:** becoming someone whose approval counts. The product needs to
know exactly one thing — that this account is one unique human, and not the
second account of someone who already has a vote. **Proof of Human is the minimum
sufficient credential**: a passport would reveal nationality and name for no
benefit; Selfie Check is weaker against one person operating several accounts,
which is precisely the attack on a group treasury.

How the pieces bind: the signal is the relation's id, so a proof cannot be
replayed into another group. The nullifier is per (app, action) — the same human
presents the same nullifier in every relation — and "one human, one vote" per
relation is the `treasury_seats(room, nullifier)` unique index: a second account
of the same human bounces off it. The trade-off we accept: because the action is
app-wide, the stored nullifier links one human's votes across relations on our
server. A per-relation action would remove that link at the cost of registering
an action per group (the action is `treasury-seat` — its registered id, kept
when *seat* became *vote*). A vote can be claimed with exactly one protocol
(World ID 3.0 from the `orbLegacy` preset): a 3.0 and a 4.0 proof of the same
human carry different nullifiers, so accepting both would give one human two votes.

- **Time to first success:** about **1 h 50 min** from starting the v4 port
  (00:05 JST, when we learned the July static `rp_context` would not work) to
  the first verified vote through the World ID simulator (01:53) — of which
  roughly 25 minutes were Portal steps (registering the relying party, then
  finding where actions live). Click-to-vote in the product: **≈14 s**.
- **Friction:**
  1. Our July integration read a static `rp_context` from env; IDKit v4 needs a
     per-request RP signature (`signRequest`, Portal signing key). Only the
     signatures spec page says so — the overview/integrate pages imply it.
  2. Verify moved from `developer.worldcoin.org/api/v2/verify/{app_id}` to
     `developer.world.org/api/v4/verify/{rp_id}` (payload forwarded as-is).
  3. The Portal's order is enforced but undocumented: actions stay locked
     ("Finish registering your relying party to create actions") until the RP
     is registered, and the app's **Dashboard** menu item is where actions
     live. The new action came with max verifications = 1 and 1 account per
     user, with no control to change either — and on the v4 verify path neither
     stopped the same human verifying twice. Uniqueness is the RP's job
     (our `(room, nullifier)` index caught the second account); the Portal
     fields look authoritative but are inert here. The simulator itself was
     smooth: IDKit hands out a ready `simulator.worldcoin.org/?connect_url=…`
     link, and "Continue" returns a proof in seconds.
- **Missing capability / docs:** during the 3.0 → 4.0 migration there is no way
  to relate a human's 3.0 and 4.0 nullifiers, so "accept both" means tracking two
  nullifier spaces yourself; we pinned vote claims to one protocol instead. Also missing: a statement of
  which Portal action settings apply to v4 proofs (max verifications / accounts
  per user did not), and where the RP signing key comes from (it is issued when
  you register the relying party).
- **The one improvement with the greatest impact:** put the per-request RP
  signature at the top of the IDKit v4 integrate guide, with the server snippet
  (`signRequest` → `rp_context`) next to the widget snippet — it is the step
  every v3 integration misses, and the widget cannot run without it.
