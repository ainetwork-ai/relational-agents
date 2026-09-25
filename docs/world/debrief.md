# Integration debriefs — World ID (ETHGlobal Tokyo 2026, Continuity)

Two surfaces, two debriefs, both built from the timestamped
[integration log](integration-log.md) — times below are measured, not recalled.

## 1 · World ID for Agents (sandbox IdP) — agent approvals

**Where it sits:** every critical treasury action the Relation Agent is about to
execute waits for fresh step-ups from distinct humans. Request (agent's card in
the room) → user completion (IdP, `max_age=0`, `prompt=login`) → validated
result (server: JWKS signature, iss/aud/exp, nonce, `auth_time` after the action
was created, pairwise `sub`) → protected action (the agent's on-chain transfer),
counted by DISTINCT subs per action. Denied paths: cancelled at the IdP, same
human from a second account, unseated member, stale proof, policy violation
(refused before any approval is requested).

- **Time to first success:** _TBD from log_ (discovery → first validated id_token)
- **Friction:**
  1. _TBD_ — client registration is interactive (portal login, 20-minute approval
     window) and HTTPS-only redirects, so localhost cannot iterate; we built a
     local mock with the same discovery shape to develop against.
  2. _TBD_ — freshness semantics: whether `max_age=0` / `prompt=login` force a
     re-verification in the sandbox, and whether `auth_time` is always present.
  3. _TBD_ — the docs page for World ID for Agents lists no endpoints; we read
     `/.well-known/openid-configuration` directly.
- **Missing capability / docs:** _TBD_
- **The one improvement with the greatest impact:** _TBD_ — candidate: let the
  step-up request carry an authorization detail (what is being approved, e.g.
  RFC 9396 `authorization_details` or a signed claim) echoed in the id_token, so
  a relying party doesn't have to bind "which action" itself through
  state/nonce + time windows.

## 2 · IDKit — claiming a treasury seat

**Trust moment:** becoming someone whose approval counts. The product needs to
know exactly one thing — that this account is one unique human, and not the
second account of someone already seated. **Proof of Human is the minimum
sufficient credential**: a passport would reveal nationality and name for no
benefit; Selfie Check is weaker against one person operating several accounts,
which is precisely the attack on a group treasury. Signal = the relation's id
(the proof cannot be replayed into another group); one nullifier per
(relation, action) — a second account of the same human bounces off
`treasury_seats(room, nullifier)` ("one human, one seat").

- **Time to first success:** _TBD_
- **Friction:**
  1. Our July integration read a static `rp_context` from env; IDKit v4 needs a
     per-request RP signature (`signRequest`, Portal signing key). Only the
     signatures spec page says so — the overview/integrate pages imply it.
  2. Verify moved from `developer.worldcoin.org/api/v2/verify/{app_id}` to
     `developer.world.org/api/v4/verify/{rp_id}` (payload forwarded as-is).
  3. _TBD_ (simulator / staging experience)
- **Missing capability / docs:** _TBD_
- **The one improvement with the greatest impact:** _TBD_
