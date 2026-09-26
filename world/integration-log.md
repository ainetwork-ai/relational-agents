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
- 2026-09-26 02:24 — Agents — **sandbox IdP client registered** through the
  world-id-agent-plugin MCP (`request_oidc_client_registration` → portal
  approval): client `c2b39b28-289d-4676-8a16-96f06cbf5000` "AINMem Relation
  Treasury", `client_secret_basic`, redirect
  `https://ainmem.ainetwork.ai/api/auth/world/callback` only, status active.
  Request staged 02:22, approved and created 02:24:30 (≈2 min; the 20-min
  approval window was not a constraint). Secret went straight from the Portal
  page into `.env.local` by hand — never through the agent (the MCP's rule).
  Credentials checked without a user: token endpoint answers `invalid_grant`
  to a bogus code with our secret, `invalid_client` to a wrong one.
  FRICTION: (1) the plugin installs into the default Claude config dir, so a
  session running with `CLAUDE_CONFIG_DIR` set never saw it — reinstalled
  there. (2) Login took two rounds: the first consent granted `world-id:read`
  only, portal tools then demanded `developer-portal:manage` (Google) and the
  server dropped the connection until re-auth. (3) On a remote dev box the
  OAuth redirect lands on the laptop's `localhost:<port>/callback` and fails to
  load — pasting that URL back into Claude Code finished it, but the page looks
  like an error and got closed once. (4) Registration with an extra
  `http://localhost:3110/...` redirect URI was refused with a bare
  `invalid_request` (no reason given); prod-only succeeded. So the real IdP
  path can only be exercised end to end on prod; local dev stays on
  `WORLD_IDP=mock`.
- 2026-09-26 02:39 — Agents — **correction: the client above points at the
  wrong domain.** The live demo is `memory.ainetwork.ai` (this host,
  `memory-live-app`), not `ainmem.ainetwork.ai`. Adding the right redirect to
  `c2b39b28…` was refused with `invalid_sector_identifier`: the first
  registration pins the client's sector to the first redirect's host
  (immutable), and pairwise `sub`s derive from it — a second host needs a
  sector document served from the first. Registered a new client instead:
  `e82cf4d2-5a57-4af5-9eb2-d4ee98c55b6c`, redirect
  `https://memory.ainetwork.ai/api/auth/world/callback`, sector
  `memory.ainetwork.ai` (staged 02:37, created 02:39:46). Old client set to
  `disabled` (clients can't be deleted). Credentials checked the same way
  (`invalid_grant` vs `invalid_client`). FRICTION: the secret pasted from the
  Portal picked up a trailing Korean IME character (`ㅅ`) — `invalid_client`
  with no hint; found by checking the value for non-token bytes. Lesson for the
  debrief: pick the redirect host before registering — it becomes the identity
  sector and can't be moved.
- 2026-09-26 02:5x — both — **deployed to memory.ainetwork.ai** (this host,
  `memory-live-app`): image `a59a23b` (origin main + this log), previous
  `640339c` kept for rollback. `.env.prod` gained the sandbox client + RP values
  (backup beside it); no `WORLD_IDP`, so the client id selects the sandbox.
  Schema: pre-deploy `pg_dump` (verified readable), drift check listed 7 tables
  + 3 `users` columns; applied as one additive transaction after a rehearsal on
  a restored copy (`drizzle-kit push` was unusable — it stalls on a prompt
  because prod's hand-made unique constraint is named `users_google_sub_key`,
  not `users_google_sub_unique`; no data issue). After: drift "schema matches",
  `/api/health` 200, client id/secret server-side only (not in static chunks).
  Still to measure: first real IdP sign-in on prod (time to first success).
- 2026-09-26 03:00 — Agents — **the demo is `ainmem.ainetwork.xyz`**, not
  memory.ainetwork.ai: third client `aaa59595-9b57-44e5-8902-09dfc7dc4274`,
  redirect `https://ainmem.ainetwork.xyz/api/auth/world/callback`, sector
  `ainmem.ainetwork.xyz` (staged 02:58, created 03:00:02). Secret pasted into
  `.env.xyz` by hand; `invalid_grant` vs `invalid_client` check passes.
  memory.ainetwork.ai keeps its own client `e82cf4d2…` and deploy. Found on
  the way: `docker-compose.xyz.yml` passed no build args, so no `NEXT_PUBLIC_*`
  (World ID app id) ever reached the xyz browser bundle — fixed alongside.
  Three registrations for one app: each deploy domain is its own identity
  sector, so a World human gets a different pairwise `sub` on each.
- 2026-09-26 03:36 — both — **ainmem.ainetwork.xyz now serves a World-enabled
  build** (`ainmem_xyz-app:e6d5dd7`, previous `e6b8fd4` kept). Root cause of
  the missing app id: deployment.md §1.1 said to build with a bare
  `docker build`, which passes no build args, so every xyz image (three today)
  shipped `NEXT_PUBLIC_WORLD_ID_APP_ID` empty and the vote fell back to the
  dev simulator; the server side (`WORLD_CLIENT_*` from `.env.xyz`) was live
  since 03:09 regardless. Fixed by (1) `docker-compose.xyz.yml` passing the two
  World values `.env.xyz` sets — a first version passed all eight
  `NEXT_PUBLIC_*` and inlined `""` over the code's defaults (registry chainId
  became 0), caught by diffing the candidate image against the live one;
  (2) the doc building through compose. Verified before the swap: 178 routes
  identical to live, album 2x2 (PR #12) present, no regression markers, app id
  in exactly one static chunk; after: health 200, container has all World
  values, DB schema already matched (no migration). Not yet on xyz: the Tokyo
  Trip seed (treasury rows 0, seats 0) and any real IdP sign-in — both to do
  before recording.
- 2026-09-26 03:58 — both — **Tokyo Trip seeded on ainmem.ainetwork.xyz**
  (`seed-tokyo-trip.mts --reset --app https://ainmem.ainetwork.xyz`, run from a
  clean worktree against the xyz DB/OKF with the xyz `SESSION_SECRET` — the
  agent's wallet key is sealed under it; checked that it unseals with the xyz
  secret and not the dev one). Room `3ed9f7fa…`, agent wallet
  `0xe03F…Cf2a` funded to $1,000 (0.005 SepETH, tx `0x8088…32f2`), 6 rules
  adopted, votes seeded for Chris·Dana·Eli, six demo accounts, no World
  bindings. Pre-flight on the live app as Alex: `idpMode: sandbox`,
  `seatMode: world-id-v4`, balance $1,000 — the takes would show World.
  Backups before: `~/ainmem-xyz-backups/20260926T035439Z-pre-tokyo-seed/`.
- 2026-09-26 04:06 — both — sign-in by link: `GET /api/auth/demo-login?as=<slug>`
  (same guard and accounts as POST) so members can be switched by clicking,
  deployed twice — `4574ae4` redirected to `https://0.0.0.0:3000/`
  (deployment.md §4.11 again; this host has no GOOGLE_REDIRECT_URI to borrow
  an origin from), `7dc7cd3` answers a relative `Location: /`. Verified like a
  browser: link → 303 → `https://ainmem.ainetwork.xyz/` signed in as Alex.
  Live: `ainmem_xyz-app:7dc7cd3`. Still to measure on xyz: a real vote through
  the simulator and a real IdP approval (time to first success on the demo host).
- 2026-09-26 05:00 — both — **the panel no longer depends on the build**: the
  xyz auto-deploy (cron, bare `docker build`, merged 04:29 as PR #16) had
  replaced the compose-built image and the panel again said the app id was
  missing. `1c7e0e4`: the treasury status carries `seatAppId` from the
  server's env and the panel prefers it; `?as=…&returnTo=` lands a member in
  the room. Auto-deployed 04:57→04:59:59.
- 2026-09-26 05:04 — Agents — **first real IdP approval on the demo host**,
  measured: Alex `@agent pay the hotel deposit, $180` → pending 0 / 2 → Chris
  (a second browser) → our confirmation page → World ID Agents sandbox →
  back with "Your approval was recorded with a fresh World ID verification",
  1 / 2 · Chris. Confirmation-page click to room: **4.8 s**. What the sandbox
  actually does (measured on plain verifications too): its page says
  "Sandbox · Uses fake identities" and completes with no human action
  (Preparing verification → Hello, human → redirect, ~3 s); one fake human
  per browser (`__Host-idp-mock-identity` cookie) — Alex and Bea in separate
  contexts got different pairwise subs, Alex-2nd in Bea's browser was refused
  ("didn't check out"). So the same-human scene needs one browser, two
  accounts; the two-human scene needs two browsers. FRICTION: (1) the first
  Chris attempt failed with "World ID isn't reachable" — `EAI_AGAIN` from the
  container's resolver during a heavy concurrent build; the host stub resolver
  has a single upstream (192.168.1.1). Plan: `dns:` on the xyz service, and
  a cached discovery document. (2) the seeded OKF doc files were owned by the
  host user, so the container (uid 1001) got EACCES logging to Treasury
  Activity — fixed with a+rw on the demo doc tree; the seed should chmod what
  it writes when OKF_ROOT is a bind mount.
- 2026-09-26 09:05 — both — **why World hops "weren't reachable" all afternoon**:
  not DNS, not docker NAT, not deploys (each was a real but smaller thing).
  Node 22's `fetch` (undici) races a host's addresses and gives each 250 ms
  to connect; `sandbox.auth.world.org` resolves to CloudFront edges that take
  ~300 ms from this host (curl: tcp 0.32 s, fine), so the container's Node
  reported `ETIMEDOUT` after ~1 s for every address — and it looked
  intermittent because the resolver sometimes returned nearer edges
  (52.84.x, 140 ms) that made it under the limit. Proven in the container:
  default node FAIL 1.1 s; `--network-family-autoselection-attempt-timeout=3000`
  ok 1.7 s; `--no-network-family-autoselection` ok 2.2 s. Fix: `NODE_OPTIONS`
  in the runner image (and in `.env.xyz` for the running one). Along the way,
  kept because each helped a real case: discovery/JWKS/token retries on
  connect-level failures (a resolver `EAI_AGAIN` right after a swap, a swap
  mid-hop), public resolvers, and host networking for the xyz app (moves the
  app's egress off the docker bridge; bind 127.0.0.1:3150). Cost of the
  detour: ~2 h of the last day. Lesson for the debrief: when a fetch fails
  where curl succeeds on the same machine, suspect the runtime's connect
  policy before the network.
- 2026-09-26 09:14 — both — **first investment executed end to end on
  ainmem.ainetwork.xyz**: Alex `@agent invest $200 of the idle funds` → the
  agent queues it citing "Investing idle funds: 3 verified members approve." →
  Chris, Dana, Eli approve, each from their own browser (three sandbox humans)
  → the agent swaps 1 USDC → 0.000371977 WETH on Uniswap v3 (Base),
  tx `0x9af1ec962d9ae5afc1f2446971cbfc253c3e9b2851b063f0e31a823711a53a4b`,
  from its own wallet `0xe03F…Cf2a`; the panel shows "+ $199.79 invested",
  priced through the same pool; the agent writes "📈 Invested $200 to
  Savings (idle funds) — 1 USDC → 0.000371977105046968 WETH via Uniswap v3 on
  Base (demo scale: $1 = 0.005 USDC)". The first attempt (3/3 at 09:03) had
  reverted at gas estimation with an empty reason: the approval's receipt came
  from one node of a load-balanced RPC and the swap was estimated on another
  that had not seen it (STF, reason stripped) — fixed by reading the allowance
  back through the same client until it shows, quoting after that, and
  sending the swap with its own gas limit. Earlier the same afternoon, the
  deposit ($180, Chris + Dana) executed the same way; the 💡 idle-funds hint
  did not post that time because the Base RPC call failed — now tolerated.
- 2026-09-26 13:22 — IDKit — **staging verification window opened for the demo
  host** with the team API key (`scripts/world-staging-window.mjs --env
  .env.xyz`): open until 2026-09-27T13:22Z; token saved, xyz app recreated
  (`091985f`) so it sends `x-staging-verification-token`. 13:28 — **first real
  vote on ainmem.ainetwork.xyz**: Alex → Claim your vote with World ID → IDKit →
  simulator ("Use the simulator", Human 1) → "🌍 Vote claimed — World ID
  confirmed you're a unique human. One human, one vote." Seat stored as level
  `orb`, nullifier `0x11a2…`, `seatMode: world-id-v4`. FRICTION: the window is
  the one prerequisite nothing in the app can supply — it needs a team API key
  and a human at a hidden prompt, closes after 24 h, and must be reopened
  before judging if judges try the live page. A hand-built probe of
  `/api/v4/verify` can't tell "window closed" from "bad proof" (schema is
  validated first), so the only check is a real simulator vote.
- 2026-09-26 14:20 — both — **recording state on xyz**: final reset
  (`--reset --no-preseat`) → room `cb5d981f…`, $1,000 (funder topped up
  $184, tx `0x764a…`), no votes, no dev votes; sign-in links regenerated.
  The rehearsal's WETH would have shown "+ $199.73 invested" from scene 0,
  so it was swapped back: 0.000372 WETH → 0.99865 USDC on Base, tx
  `0xb995cb18…379f4` (round trip cost ≈ 0.14% + gas). FRICTION: publicnode
  refused the quoter's eth_call as an "archive request" that it had served
  an hour earlier — the app's primary Base RPC is now drpc, with publicnode
  and mainnet.base.org as fallbacks. The panel's "N/6 votes" counts World ID
  proofs only; seeded dev votes draw a red ring and count for nothing — the
  three off-camera votes (simulator Human 3·4·5) are what turn it into 4/6.
- 2026-09-26 14:30 — IDKit — **the off-camera votes are real now**: Chris,
  Dana and Eli each claimed their seat in room `cb5d981f…` through the
  simulator, driven by `scripts/world-sim-vote.mjs` (one fresh browser per
  member; the "Use the simulator" link is read out of the IDKit widget's
  shadow root and opened in a tab, because the widget's overlay intercepts
  clicks). Seats stored as `orb` with three distinct nullifiers (`0x134b…`,
  `0x0516…`, `0x173d…`); the panel reads **3/6 votes** and Alex still sees
  "Claim your vote". FRICTION: the simulator is not "one human per browser"
  — every fresh browser gets the same five fixed test identities (#0–#4)
  with #4 active. The first attempt seated Chris on #4, i.e. on the very
  nullifier `0x11a2…` Alex's own simulator produced at 13:28; the next
  member on the default identity — and Alex on camera — would have been
  refused as "already has a vote". That row was deleted and the three were
  re-seated on #3/#2/#1; #4 (the default) stays Alex's, #0 is Bea's, and the
  second-account scene keeps #4 on purpose. Every reset means re-running the
  script three times.
- 2026-09-26 21:2x → 2026-09-27 00:05 — IDKit — **World now gates staging proofs.**
  A vote claim on ainmem.ainetwork.xyz came back from the simulator with
  "Staging verification is not open for this app": since the 01:53 vote,
  `/api/v4/verify` accepts staging (simulator) proofs only while the app's
  team has opened a 24 h staging verification window (Portal MCP tool
  `set_world_id_staging_verification`, authenticated with a team API key) AND
  the verify call carries that window's token as
  `x-staging-verification-token` (developer-portal
  `web/api/v4/verify/staging-access.ts`; docs.world.org says nothing). Fixed
  by `0c81747` (the header, from `WORLD_STAGING_VERIFICATION_TOKEN`) and
  `a557801` (`scripts/world-staging-window.mjs`: opens the window with the key
  at a hidden prompt and saves the token). Window opened 22:22 JST (expires
  2026-09-27 22:22 JST). **Vote claim end to end again at 00:05 JST** on the
  try-it room: click → IDKit → simulator Continue → verified → "🌍 Vote
  claimed", 45 s, of which ~25 s waiting for the IDKit modal to open.
  FRICTION for the debrief: the gate is undocumented; the refusal names the
  tool but not where the key comes from (Team settings → API keys) nor that
  the token must travel on every verify call; a window that lapses mid-event
  silently breaks every staging integration; the Portal has no button for it.
- 2026-09-26 16:50 — IDKit — **the second account now joins on camera**: the
  five friends form the room (`seed-tokyo-trip.mts` seats no sixth member any
  more; "Alex (2nd account)" stays a workspace member), and scene 2 starts
  with Alex adding it from the room's **Invite people**. Verified on xyz end
  to end: the invite menu lists the account, the panel goes to six faces with
  "New members don't vote until the relation adopts its membership · + Alex
  (2nd account) (would vote)", and the account's own claim on the same
  simulator identity (#4) is refused with "This human already has a vote in
  this relation — one human, one vote." — no seat, nothing bound.
  `--join-alex2` reproduces that state for a take that starts after scene 2
  (block 2); the e2e mirrors it (Alex invites the account in setup; the
  same-human approval is Dana's laptop now, scene 4, and the second account is
  refused as outside the electorate before any World ID check). FRICTION: the
  deploy worktree's `app/.env.local` is a symlink to the shared dev env, so
  one seed run reset the dev "Tokyo Trip" room instead of xyz — the xyz DB,
  secret and content root must be passed inline. Two claims got a transient
  `generic_error` from the staging verifier; the retry went through.
  Recording state: room `1ebca8bc…`, $1,000, Chris/Dana/Eli seated (`orb`),
  Alex and Bea unseated, nothing invested.
- 2026-09-26 17:30 — both — **one block, shot in order**: shooting scene 4
  in its own block (so that Dana reached it with no IdP step-up) showed
  `$1,000.00` and no invested badge between scenes that show ~$616 and
  "+ $199.72 invested". Scene 4's lent laptop is Eli's now and scene 3½'s
  approvers are Chris, Dana and Bea, so nobody reaches scene 4 bound and the
  whole video is one reset, S0 → S6. Bea's vote moved off camera (simulator
  #0) with Chris #3, Dana #2, Eli #1; recording room `1ebca8bc…` holds those
  four seats, Alex (#4) claims on camera. The e2e's same-human void is on
  Eli's account to match.
- 2026-09-26 18:20 — both — **rehearsal of S3 → S3½ → S5 on xyz, with the
  investment leaving the pot** (`2013c2a`). $180 deposit approved by Chris and
  Alex → paid (`0x3dbfa4fe…`); the idle-funds proposal appeared on screen for
  the first time ("After that we hold $815.52 … $200 could work for us");
  "invest $200 of the idle funds" approved by Chris, Dana and Bea → swap on
  Base `0x05c31157…209f` (1 USDC → 0.000371682 WETH) and $200 out of the pot
  to the Savings address `0x4955…6419` on Sepolia `0xc105255b…3220`
  (status 1). Header: `$610.86 · + $199.80 invested` — the pot no longer
  counts the invested money. "send $500 to my wallet" → refused on the
  personal-wallet rule, "$500 is also 81.9% of our $610.86" (the video's S5
  moves from $700 to $500: $700 is 115% of what is left). FRICTION: another
  session's merge redeployed xyz in the middle of the three approvals — the
  third one had to be retried after the new container came up. Afterwards:
  WETH unwound (`0xeee797a9…4c5f`), room reset to `673001c2…`, Bea/Chris/
  Dana/Eli seated (`orb`, #0/#3/#2/#1), Alex unseated, $1,000, nothing invested.
