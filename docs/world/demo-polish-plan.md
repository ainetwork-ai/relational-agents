# Relation Treasury demo polish: consolidated plan

Current state (at audit time, nothing changed): localhost is `idpMode:"mock"`, 5 of the 6 members are `seatLevel:"dev-simulator"`, the balance is $820, and a $150 request is pending at 1/2. If we shot today, every take would show `(mock IdP)`, `LOCAL MOCK IDP`, the `Local mock — not World` page, and five `dev vote` chips. Before polishing the UI, first settle **where to shoot (prod) and the scene 4 script**.

---

## 0. Pre-recording prerequisites (non-UI, about 165 min total)

- **P0 [blocker] Lock the scene 4 script: "Alex picks up Dana's laptop" (20 min)**
  - The current script doesn't hold up. `approvalGate` returns `not-seated` for an account without a vote (approvals.ts:396, confirmed in code), and in scene 2 Alex (2nd account) is denied a vote. So that account has no Approve button.
  - New flow:
    1. Alex approves the $150, making it 1/2.
    2. On Dana's account, which already has a vote and has never done an IdP step-up, approve again with Alex's World ID.
    3. `bindWorldSub` returns `sub-taken`, and since there is an earlier approval with the same approverKey, `⛔ An approval was voided: the same human already approved from another account.` is posted. The card stays at 1/2. Code path confirmed at approvals.ts:492-500.
  - Scene 2 becomes "IDKit nullifier at the vote step" and scene 4 "IdP sub at the spend step", so the two World products each do one job.
  - Fix DEMO.md scene 4 and the §4 rehearsal mapping (in that take, Dana's account = Human 1).
  - Don't say "only the vote holder themselves can approve" in the narration. The vote nullifier and the IdP sub are not linked, and judges may call it out.
- **P1 [blocker] Shoot everything on https://memory.ainetwork.ai, and bundle the UI fixes into a single deploy (30 min)**
  - The sandbox IdP client's only redirect is memory.ainetwork.ai; registering localhost was refused (integration-log 02:39). So localhost is mock forever.
  - The prod build also drops the Next dev indicator (`N 2 Issues`).
- **P2 [blocker] Sandbox IdP dry run on prod (15 min)**
  - Create a request that needs 2 approvals and approve it once so it stops at 1/2. No money moves.
  - Check that the green banner appears. This checks that the id_token carries `auth_time`. If it doesn't, approvals.ts:484 fails closed with `stale-proof`, and scenes 3 and 4 all end in red. In that case, decide on the remedy (ask World, or a flagged iat fallback) before shooting.
  - Screenshot the sandbox screens and time them to pick cut points. integration-log is still at "Still to measure".
- **P3 Final reset (20 min)**
  - Run `seed-tokyo-trip.mts --reset --no-preseat` inside the prod container, because the OKF disk, DB, and RELAYER_KEY live in that container.
  - Confirm the new agent wallet holds $1,000 and the sidebar tree was rebuilt with the new profile.
  - Order: rehearsal → final reset → vote claims only → shoot.
  - DEMO.md setup step 1 ("Chris·Dana·Eli already have a vote") contradicts step 3, so rewrite it for `--no-preseat`.
- **P4 Simulator identities (20 min)**
  - Give Alex, Chris, Dana, and Eli each their own simulator.worldcoin.org identity.
  - Chris, Dana, and Eli claim off camera; Alex claims on camera in scene 1. Alex2 uses Alex's identity (the scene 2 denial).
  - On the IdP, Chris and Alex must be different World IDs. Dana never steps up before scene 4.
  - Rename the Developer Portal app from `ETHTokyo2026` to `Relation Treasury` (shown in the IDKit sheet). Leave the action id `treasury-seat` as is.
- **P5 Per-take pre-flight (5 min)**
  - `GET /api/dm/rooms/<room>/treasury` must return `idpMode:"sandbox"` and `seatMode:"world-id-v4"`, with 0 `dev-simulator` seats and a balance of $1,000.00.
- **P6 Browser setup (25 min)**
  - Create one Chrome profile per person (Alex, Alex 2nd, Chris, Dana). Give each profile a different color so the window border changes when switching accounts.
  - Each profile does demo-login once and sets a `lang=en` cookie on memory.ainetwork.ai.
  - **1920x1080 window at 125% zoom**, clean profiles with no bookmarks bar or extensions, tabless app windows (Etherscan is the exception), sidebar on the Chats tab.
  - Never open the agent dock, inbox, home, or header tooltips on camera.
  - Keep one simulator window per person as "that person's phone". Alex's single phone answering on Alex's, Alex2's, and Dana's laptops is the "one human" story itself.
- **P7 Shot list and pre-recording (30 min, DEMO.md)**
  - Pre-record:
    - the scene 1 IDKit step (about 14 s)
    - all of scene 2
    - both IdP runs in scene 3. The chain wait of about 40 s becomes a jump cut captioned `~40 s later on Sepolia`.
    - all of scene 4. No cut from the Approve click to the voided line.
  - Live: the scene 1 opening, the $180 request, Etherscan, scene 5, scene 6.
  - Edit captions:
    - scene 1–2: `World ID · IDKit — Proof of Human`
    - scene 3–4: `World ID for Agents — fresh step-up`
    - account switch: `Chris's laptop`
    - Etherscan: testnet notice
  - DEMO.md fixes:
    - scene 1: "beside" → "one click away"
    - scenes 3 and 5: update the quotes to the new wording once M7 and M8 land
    - scene 6 narration → "every payment, who approved it, and every refusal"
- **P8 Fallback (0 min)**
  - If the sandbox fails on the day, jump-cut from the confirmation page straight to the room. Never put the mock IdP page on screen.

---

## 1. MUST — required before recording (265 min total)

| # | What changes | File | Min | Scene |
|---|---|---|---|---|
| M1 | **Rebuild the pending card.** Replace the 6px progress bar with one slot per required approval. A filled slot is emerald `✓ Chris · 14:02` (`approvals[].at`, Asia/Tokyo time), which becomes the evidence of "verified just now". An empty slot is dashed `verified human`. On the right, `1 of 2 verified humans`. Title `text-xl` `$150.00 to Hotel Gracery Shinjuku` (memo only when it adds words). Second line `requested by Alex · expires in 10 h · 0x466e…CB86` in `text-sm`. Rule quote `border-l-2 italic`, card `p-4 shadow-sm`. For someone who already approved: `✓ You approved — waiting for 1 more human.`. For someone without a vote: `No vote on this account — only verified humans can approve.`. Button `🌍 Approve with World ID` with `px-4 py-2 font-semibold`. Move the aria onto the slot row. | treasury-panel.tsx:497-585 | 50 | 3, 4 |
| M2 | **Panel header and chip cleanup.** Header: muted `Shared treasury` followed by the balance in `text-base font-semibold tabular-nums`, with muted `AI manages the money · humans approve it` on the right (visible even when collapsed). A `One human, one vote` label before the chips. Chip text `Alex · 🌍 vote` and `Alex (2nd account) · no vote` (not "no vote yet"). Remove the `✓ World ID` span and move it into a tooltip. Add `(you)` to the viewer's chip (add `me` to status.members). Keep dev seats marked in amber. Replace `Sepolia · testnet scale` with a first body line `Agent wallet 0xc299…690f · Sepolia testnet`, tooltip `Testnet demo: $1 = 0.000005 SepETH`. | treasury-panel.tsx:267-316,386-416; approvals.ts:1129; types.ts | 30 | All |
| M3 | **Fix the order of member chips and header avatars.** Add `.orderBy(asc(joinedAt), asc(userId))` to the room GET (which has no ORDER BY), treasuryStatus, memory, and skill queries. The seed spaces joinedAt 1 second apart in PEOPLE order so the order is Alex, Bea, Chris, Dana, Eli, Alex (2nd account). Takes effect after reset. | api/dm/rooms/[roomId]/route.ts:65-68; approvals.ts:996; memory.ts:118; skill.ts:252; seed:250-253 | 15 | 1–4 (account switches) |
| M4 | **Scene 1 claim flow.** Auto-expand when there's no vote, with `open = … \|\| !status.mySeated`. On a successful claim, pin it open with `setOpenOverride(true)` so the panel doesn't collapse the moment the chip turns into `🌍 vote`. Success banner: `🌍 Vote claimed — World ID confirmed you're a unique human. One human, one vote.` | treasury-panel.tsx:266, SeatButton onClaimed | 15 | 1 |
| M5 | **Result banner.** Store a code instead of text. If the code is `executing` and the latest history entry is executed, switch to the executed text; if it failed or was blocked, take the banner down. Today "paying now…" stays up on the final frame of the payment scene. Strip the jargon from the text: approved `✅ Approved — World ID confirmed a unique human, just now.`, executing `✅ That was the last approval needed — the agent is paying now.`, executed `… — the agent paid.`, same-human `⛔ Not counted — this human already approved from another account. One human, one vote.`. Rewrite stale-proof and not-seated in story-lens wording too. | treasury-panel.tsx:39-84,154,327 | 20 | 3, 4 |
| M6 | **Freshness on the approval chat line.** `✅ Chris approved with World ID — 1 of 2 · fresh check at 14:02, after this request`. Still matches the e2e:431 regex (`Chris approved with World ID — 1 of 2`). For the World ID for Agents judges, this is the heart of the integration. | approvals.ts:540-544 | 15 | 3, 4 |
| M7 | **Line breaks and tightening in agent replies.** The bubble is pre-wrap, so split with `\n`. Queued is 3 lines: `⏳ Queued: $180 to Hotel Gracery Shinjuku (hotel deposit).` / `Needs 2 verified humans — our rules: “…”` / `Approve with World ID in the treasury panel above.`. Drop the "one human counts once" sentence to save the scene 4 twist. Split the $700 refusal into lines too (`I won't do that.` / rule / `$700 is also 85.4%…` / purpose / `Rules: /p/…`). `would also be` → `is also`. Align the adoption reply (skill.ts:608) the same way. | skill.ts:107-109,331-334,381-391,511-515,608; DEMO.md; check e2e 366/475 | 25 | 3, 5 (climax) |
| M8 | **Result records (chat Paid line and Treasury Activity page).** Chat: `✅ Paid $180 to Hotel Gracery Shinjuku (hotel deposit).\nApproved by 2 verified humans: Chris and Alex · tx 0xbf04…`, without the gas aside. Activity: `✅ Paid … — approved by Chris and Alex · [tx 0xbf04…bcab](https://sepolia.etherscan.io/tx/…)`, without the refund tx and relayer text. Request line `📝 Alex asked: $180 · hotel deposit — needs 2 humans to approve`, refusal line `⛔ Refused: $700 to Alex's own wallet — “…”`. Add the approval line (same sentence as M6) and the voided line via `logActivity`. Date headings use an Intl-formatted `Friday, Sep 25` instead of ISO; change memory.ts and the seed's isoDay together (it's the dedupe key, so do it before the final reset). | approvals.ts:488-500,540,881-891; skill.ts:378,508; memory.ts:211-229; seed:319-320; e2e 378/429 | 40 | 3, 6 (final frame) |
| M9 | **Memory doc names.** For a folder with an index.md, the sidebar and breadcrumb use the index's `# ` title instead of the folder name. That removes hash suffixes like `-b96c89`. A lighter fallback is stripping `/-[0-9a-f]{6}$/`. | okf-store.ts:136-160,185-195 | 20 | 1, 6 |
| M10 | **Minimal confirmation page cleanup.** `body{min-height:100vh;display:grid;place-items:center}`, main 34–36rem, card padding and shadow, h1 40–44px. Kicker `Tokyo Trip · shared treasury → World ID for Agents` (add roomName to ApprovalCard). Add `Approving as Chris`. `Paid to` → `Sends to`. Approval line `Approved so far: Alex — 1 of 2 needed`. Expiry `in 10 h (19:12 Tokyo)`. Above the button, `The agent can't send this until 2 different humans approve it with World ID.`; button `🌍 Approve with World ID`. Keep the full address and the CSP, and keep the font as system-ui. | connect/route.ts:183-257; approvals.ts(ApprovalCard) | 25 | 3 (4-second still) |
| M11 | **Clear notifications on seed reset.** Delete `notifications` for the 6 demo users (or by roomId). Chris's bell going from 0 to 1 on the new $180 request actually makes a good shot. Fallback: "Mark all as read" in each profile. | seed:116-161 | 10 | 3 (Chris's screen) |

---

## 2. SHOULD — if time allows (215 min total)

| # | What changes | File | Min | Scene |
|---|---|---|---|---|
| S1 | **The rest of the panel visual cleanup.** Switch chips to a white neutral style so they fit on one line at 125% zoom. Sections `mx-0`. Delete the truncated purpose line. A `📄 Our rules →` link on the right of the wallet line. | treasury-panel.tsx:369-416 | 20 | All |
| S2 | **Chat result tone.** The agent's `✅` messages get `bg-emerald-50 ring-emerald-200`; `⛔` and `I won't do that` get `bg-red-50 ring-red-200`. | dm-view.tsx:962-967 | 25 | 3, 4, 5 |
| S3 | **More specific voided text.** `⛔ Not counted: the World ID just verified on Dana's account already approved this payment from another account. One human counts once — still 1 of 2.` Don't say who matched (see the conflict resolution below). Check whether any e2e asserts on the voided string. | approvals.ts:487-500,528-536 | 15 | 4 |
| S4 | **The Sepolia wait.** Right after quorum is reached, before transferUsd, post `⏳ 2 of 2 verified humans — paying $180 to Hotel Gracery Shinjuku on Sepolia now.` as the jump-cut starting point. Show a pulse and elapsed seconds on the paying card. Don't take the option of posting Paid first (the balance would show $819.xx). | approvals.ts (just before transferUsd); treasury-panel.tsx:551-559 | 20 | 3 |
| S5 | **The panel mounts late and pushes the chat.** Cache TreasuryStatus in sessionStorage on refresh and apply it in a mount effect (hydration-safe). Put a ResizeObserver on `dm-messages` that re-sticks to the bottom if it was at the bottom. | treasury-panel.tsx; dm-view.tsx | 25 | 2–4 (returning from the IdP) |
| S6 | **Standardize on "memory" and tag only once.** In en.ts change to `Our memory`, `Memory`, `What the agent remembers from this room`, `Remembered`, ` · The agent remembers what's said here`. Put the `Remembered` tag only on the last message of a consecutive run of recorded messages. Seed line: `Deal. The agent has our rules in its memory now.` | en.ts:19,116,136,137,203; dm-view.tsx:725-730,992; seed:223 | 25 | 1 |
| S7 | **Add a `group` profile.** Doc title `Shared memory`, 🧠, with only an Overview section; the seed's 4 treasury pages fill in the rest. The 6 empty business sections and `Working record` go away. The alternative is keeping the sidebar tree collapsed until scene 6. | profiles/group.ts + registry; okf-docs.ts:94,130; seed:256-265 | 45 | 6 |
| S8 | **World-facing text.** Change action_description to `Claim your vote in this group's shared treasury — one human, one vote.` and the denial text to `This human already has a vote here — one human, one vote.`. `SAME_HUMAN_SEAT` and `MSG.seatSameHuman` must change together (if they differ, two lines get printed). | seat-button.tsx:145; treasury-panel.tsx:86; approvals.ts:66 | 10 | 1, 2 |
| S9 | **Restyle the claim box.** Replace the dashed border with a solid `bg-neutral-50` box, title `Claim your vote`, button on the right. Remove seat-button's `mt-2`. | treasury-panel.tsx:424-469; seat-button.tsx:136 | 10 | 1 |
| S10 | **The "Edited just now" contradiction.** Change the OKF page's updatedAt to the file mtime. Make the panel link `📄 Our rules · adopted Sep 25 →` so the screen backs up the "adopted version" narration. Don't put a callout inside the Rules page: every line is parsed as a rule, so it would fail closed. | okf-store.ts:503; treasury-panel.tsx:374-381 | 20 | 1 |

---

## 3. COULD — later (265 min total)

| # | What changes | File | Min | Scene |
|---|---|---|---|---|
| C1 | Dock the panel to the right of the chat on wide screens | dm-view.tsx; treasury-panel.tsx | 120 | All |
| C2 | A 1.2 s emerald flash when the balance changes; color-highlight the latest history entry if it was decided within 90 s (needs `decidedAt`) | treasury-panel.tsx; approvals.ts; globals.css | 25 | 3, 5 |
| C3 | Doc page icons from frontmatter `icon:` (🏦 Rules, 📒 Activity, 🎯 Purpose, 🏨 Payees) | okf-store.ts; p/[pageId]/page.tsx; seed | 30 | 1, 6 |
| C4 | Hide the agent dock on `/dm/*`, route SUGGESTIONS through `t()` and into English, name it `${ws.name} agent` (the stored user row too) | assistant-dock.tsx:24; api/assistant/route.ts:43 | 15 | All |
| C5 | A differently colored avatar per person (SVG data URI). Alex2 distinct from Alex, the agent 🏦 | seed | 20 | All |
| C6 | `document.title = "Tokyo Trip · Shared treasury"` | dm-view.tsx | 5 | Only when tabs are visible |
| C7 | Inbox treasury notification title (`Alex asked the group to approve a payment`) | inbox.tsx:38-46 | 15 | Inbox (not on screen) |
| C8 | Auto-close IDKit about 1.5 s after success | seat-button.tsx:150-162 | 10 | 1 |
| C9 | Gate `devIndicators` behind an env var (`HIDE_DEV_INDICATOR`), add a catch to the uncaught fetches on the room page | next.config.ts; dm/[roomId] | 25 | Local rehearsal |

Home's `aindrive is not configured`, the truncated workspace name, and the `Page` tab are handled by keeping them off screen, not by fixing code.

---

## 4. Conflicts between lenses, and the decisions

1. **Scene 4 solution:** The proposals were Bea's account (visual), merging into scene 2 (story), and Dana's account (flow·judge). **Decided on Dana.** Under the `--no-preseat` plan, the people who definitely have a vote are Chris, Dana, and Eli, so Bea is uncertain. Merging into scene 2 would lose the core World ID for Agents scene, where the IdP sub catches duplicates across accounts. Story's no-vote card text went into M1 and can be used as a 2-second cut if wanted.
2. **devIndicators:** All four lenses rated it MUST, but shooting on prod (P1) solves it on its own, so it was **demoted to COULD.** On the shared dev server, toggle it only through the env gate.
3. **Chip order:** Voters first on the client (story) vs. deterministic on the server (the rest). **Decided on the server.** With voters-first ordering, the chips would jump the moment Alex claims in scene 1.
4. **Purpose line:** The proposals were delete (visual), a `For:` prefix (story), and a two-line clamp (flow·judge). **Decided to delete.** Height is tightest at 125% zoom, and the same content appears in the scene 5 refusal and on the Purpose page.
5. **Header slot:** Testnet pill and Rules link (visual) vs. slogan (story). **The slogan goes in the header**; wallet, testnet, and the Rules link move to the first body line. This is the only place judges can see the slogan.
6. **Queued reply:** Short CTA (visual) vs. 3-line structure (story). **Use the 3-line structure with a short CTA.** Drop "one human counts once" to save the scene 4 twist.
7. **Activity request line emoji:** ⏳ (story) vs. 📝 (visual). **Decided on 📝.** A request is an event, and ⏳ reads as still pending even after it's paid.
8. **Date headings:** Story's example `Thu, Sep 25` has the wrong weekday (2026-09-25 is a Friday). Besides, the heading will be the recording day's date. So **compute it with Intl; don't hard-code it.**
9. **Naming in the voided text:** Judge proposed revealing that "the person verified on Dana's account is the same person as Alex". **Name only the account that tried (Dana), not the person it matched.** Under World ID's unlinkability principle, there's no need to tell the whole room which accounts are the same person. A World engineer could call this out.
10. **Recording resolution:** 1440x900 (judge) vs. 1920x1080 @125% (visual·flow). The final video is 1080p, so **1920x1080 @125%** (CSS 1536x864).
11. **Confirmation page font:** Inline the app font (flow) vs. system (judge·visual). The CSP is `default-src 'none'`, and on the recording Mac system-ui renders as SF, so **keep system-ui.**
12. **Right-docked layout:** Visual rated it SHOULD, but it was **demoted to COULD.** It's a 120-minute change and the riskiest one on recording day. 125% zoom, collapsing the panel in chat scenes, and cuts are enough.
13. **Doc names:** Split into sidebar hash removal (M9) as required and the `group` profile (S7) as optional. Hashes look fake, but the empty business sections can be hidden by keeping the tree collapsed.

---

## 5. Totals and recommended order

- MUST UI: **265 min**
- SHOULD: **215 min**
- COULD: **265 min**
- Prerequisites: **165 min**
- Minimum path (MUST + prerequisites): about **7 hours**

Recommended order:
1. P0 lock the script
2. P2 dry run (first, because the `auth_time` check is the biggest unknown)
3. MUST code fixes (plus SHOULD S2, S3, S4 if possible)
4. P1 a single prod deploy
5. P3 final reset
6. P4 claims
7. P5 pre-flight
8. P6 and P7 recording

The audit didn't touch code or the seed. Captures are in `/mnt/newdata/comcom_data/tmp/claude-1000/-mnt-newdata-git-notion/b7ef8e2d-0f75-4314-a74e-19af65e14fd4/scratchpad/demo-audit/`.
