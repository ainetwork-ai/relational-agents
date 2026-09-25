# World integration log (raw, timestamped — source for the two debriefs)

Kept from hour 0 so the debrief reports measured times, not memory.
Format: `JST time — surface — what happened`.

> **Note on the times (added after the fact).** The entries stamped 23:50 and
> 00:05 below — and the plan's "v3.1 (… 2026-09-26 00:10)" heading — are later
> than the commit that first contains them (`9fa10ce`, 23:44:23 JST), so they
> are not wall-clock measurements; read them as approximate. The implementation
> commits `aa9fc39..a4c81bb` all carry 00:10:57 JST: one working session was
> split into those units and committed together. Entries from 01:32 on are
> written when the event happens.

- 2026-09-25 22:40 — IdP — sandbox OIDC discovery answered first try
  (`/.well-known/openid-configuration`: authorize/token/jwks/device endpoints,
  client_secret_basic|post|private_key_jwt). Friction: docs page for "World ID
  for Agents" gives no endpoint list; had to read discovery directly.
- 2026-09-25 22:50 — IdP — client registration is interactive (portal login +
  20-min approval window) and HTTPS-only redirect → cannot iterate on
  localhost; building a local mock IdP with the same discovery shape.
- 2026-09-25 23:10 — IDKit — cross-review found the repo's July dev-simulator
  path mints nullifiers server-side (never touches IDKit). Needs a Developer
  Portal staging app + simulator.worldcoin.org for real proofs.
- 2026-09-25 23:33 — hour 0 of implementation.
- 2026-09-25 23:50 — both — design settled (plan v3.1): approvals of agent
  actions = fresh World ID for Agents step-ups (sandbox IdP, max_age=0,
  auth_time checked server-side, quorum = DISTINCT pairwise subs); seats =
  IDKit Proof of Human (signal = roomId, one human one seat).
- 2026-09-26 00:05 — IDKit — FRICTION: the repo's July integration read a
  static `rp_context` JSON from env. IDKit v4 requires the RP to SIGN a fresh
  context per request (nonce + created_at/expires_at, secp256k1 recoverable,
  keccak — `signRequest` in @worldcoin/idkit-core/signing, key from the
  Developer Portal). The overview page doesn't say this; only
  /world-id/idkit/signatures.md does. Also: verify moved to
  developer.world.org/api/v4/verify/{rp_id} (payload forwarded as-is); the
  July code used developer.worldcoin.org/api/v2/verify/{app_id}.
- 2026-09-26 00:05 — Agents — found docs.world.org/agents/human-in-the-loop:
  IDKit-based approvals bound to an action string (`booking:${id}`), consumed
  once on `${action}:${nullifier}`. Same binding idea as ours; the event's
  World ID for Agents resources point at the sandbox IdP, so approvals stay on
  the IdP and we bind to the action via state/nonce + auth_time.
- 2026-09-26 01:32 — both — security review folded in, e2e 8/8 again (mock
  IdP + real Sepolia). Agents: the IdP screen can't show what is approved, so
  the app now shows a confirmation page (amount, payee + address, rule) and
  starts the step-up only from its form; an id_token without `auth_time` now
  counts as a stale proof (no `iat` fallback); token endpoint auth method is
  pinned by config (discovery lists three). IDKit: seats accept only World ID
  3.0 proofs — `allow_legacy_proofs` means 3.0 and 4.0 nullifiers differ for
  one human, so accepting both could seat one human twice.
- 2026-09-26 01:3x (corrected — first logged as 02:3x, a time that had not
  happened yet; the registration came shortly before the 01:53 seat) — IDKit —
  Portal: "Finish registering your relying party
  to create actions" — actions stay locked until the RP is registered (the
  Signer address field was empty). Registering produced the RP signing key
  (secp256k1; signer 0x0652…cDD7). First server-signed rp_context from our
  route right after (seatMode → world-id-v4, environment staging). FRICTION:
  the Portal's order (RP registration before actions) isn't in the docs; the
  app page's "Dashboard" menu item is where actions live (…/world-id?tab=actions).
- 2026-09-26 01:53 — IDKit — **first real World ID seat, end to end** (staging, World ID
  simulator identity 0x18310f83): our server signed rp_context → bridge request
  → simulator "Complete verification · Unique Human · Claim your approver seat…"
  → Continue → v4 verify → seat (level orb). Click-to-seat ≈ 14 s. Measured
  time to first success for IDKit: RP registered ~01:3x → first seat 2026-09-26 01:53
  (the ~25 min between were the Portal steps + locating the Actions tab).
- 2026-09-26 01:53 — IDKit — **same human, second account → refused** (409 "This human
  already holds a seat in this relation — one human, one seat.") — caught by
  our (room, nullifier) index, NOT by the Portal: although the action shows
  max_verifications=1 / max_accounts_per_user=1 (and the Portal UI offers no
  way to change them), the v4 verifier accepted the same human's second
  verification. FRICTION/insight for the debrief: per-action limits are not a
  uniqueness guarantee on the v4 path — the RP must enforce it (as the IDKit
  docs' "track nullifiers yourself" hints); the Portal's limit fields are
  legacy-only and silently inert here.
- 2026-09-26 02:05 — IDKit — copy: the user-facing word "seat" is now "vote"
  ("Claim your vote with World ID", "one human, one vote", and the IDKit
  request's `action_description`). The meaning is unchanged: the right to
  approve treasury actions, claimed once with Proof of Human. The action keeps
  its registered id `treasury-seat` — renaming it in the Portal would break
  verification — as do the `treasury_seats` table, the `/treasury/seat` routes
  and the `not-seated` reason code. Entries above keep the word they were
  written with.
