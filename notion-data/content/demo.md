---
title: Demo — 3-Minute Video Script & Transition Design
icon: 🎬
---

# I relate, therefore I am.

**An agent is born only when two people agree.**

Total runtime 3:00 · 1440×900 · light mode.
Concept: a relationship-management workspace. The star is the relational agent — born only by mutual consent, it manages and remembers your relationships. All scenes below use the REAL data in this workspace: the **Relationships** database (Relationships.csv) and the **Relationship Records** pages — every record titled **"Chanho ❤️ {name}"** (Chanho ❤️ Isla Montgomery, Chanho ❤️ Hannah Brooks, Chanho ❤️ Sophie Miller, and seven more).

## Setup — three wallets, two consents (off camera)

1. **Three MetaMask accounts, three browser profiles**: Chanho (the recording profile), Hannah, Ava. One profile per account — localhost cookies are shared across ports, so two logins in the same profile evict each other. Each signs in via **Sign in with MetaMask** (the account picker opens on every sign-in).
2. **Wire the triangle**: from Chanho, invite **Hannah** → switch to Hannah's profile, accept → **Chanho ❤️ Hannah** is born. Repeat with **Ava** → **Chanho ❤️ Ava**. Consent is anchored to each side's wallet identity: the accept can only happen inside a session that wallet signed into.
3. Recording profile logged in as **Chanho**, sidebar on the **Chats** tab, Relationships table one click away. Warm up the local LLM once before recording.

The pre-roll and the 2:12 finale lean on these two pre-wired relationships (the Lisbon egg tart lives with Hannah, and only there). On camera, the tenth relationship — Isla — is born fresh.

---

## Pre-roll · 0:00–0:15 · Why a relational agent?

Two title cards before the product appears. No UI yet — this is the thesis, and everything after it is the proof. Every scene below is timed to absorb this pre-roll, so the total stays at 3:00.

**Card 1 — 😈 the problem** (7s). Show `docs/img/agent.png`: one agent per human, one shared memory store holding "Egg tart with Hannah". **Ava** asks *"Remember the egg tart?"* — the red leak arrow lands, screen shake 0.2s, BGM drops.

![One agent per human — Ava's question leaks Hannah's memory](../../docs/img/agent.png)

Caption: **"Nobody hacked anything. It was being helpful."**

**Card 2 — 🛡️ the fix** (8s). Show `docs/img/relational_agent.png`: the agents sit **on the relationships** — **Chanho–Hannah** holds the egg tart memory, **Chanho–Ava** holds none. "No leak" snaps in green, BGM returns.

![One agent per relationship — the Chanho–Ava agent has no egg tart memory, no leak](../../docs/img/relational_agent.png)

Caption: **"Nothing else is in there to leak."** This plants the egg tart, so the 2:12 finale pays it off.

**VO**:
> "Ava asked Chanho's agent about the egg tart — and it answered from a memory that belongs to Hannah. No attack, just a helpful answer. So we didn't give the agent to the person. We gave it to the **relationship**: born when **both say yes**, remembering only what **the two of them** shared. There is **nothing else in there to leak.**"

## 0:15–0:33 · Opening — first login lands on the dashboard

**Screen actions**:
1. First login (MetaMask sign-in). The main page opens on the **Relationships dashboard** — the dashboard view over the Relationships database: ten ❤️ relationships at a glance, upcoming dates highlighted. Hold one beat (~2s) so the viewer orients.
2. Sidebar, **Chats** tab. In the **Direct messages** section, click the **+**. The **New direct message** modal opens with the member list.
3. Pick **Isla Montgomery** and send the first hello. A pending invite appears — "waiting for Isla."

**VO**:
> "Sign in, and you land on your relationships — all of them, one dashboard. But this story doesn't start with a page. It starts with an invitation. Chanho reaches out to Isla — one message, and the door is open."

## 0:33–1:00 · Mutual consent → the relationship is born

**Screen actions**:
1. Isla accepts the invite (flash her side / the accepted state).
2. On acceptance, a page **titles itself into being** in the sidebar: **Chanho ❤️ Isla Montgomery** — and the relational agent greets both: "I'll take care of this story with you."
3. Pull back: this heart-page now sits among nine others — **Chanho ❤️ Maya, Hannah, Sophie, Lily, Claire, Ava, Zoe, Mia, Riley** — each a relationship consented to the same way.

**VO**:
> "The record isn't created by one person — it's *agreed into existence*. The moment Isla says yes, the page and the agent are born together. Nine others already said yes. This is the tenth."

## 1:00–1:40 · It manages (real data on screen)

**Screen actions**:
1. Agent briefing over the Relationships table: highlight **Olivia — friend's wedding, Aug 2** and **Emma — Jeju trip, Aug 7**. Agent: "Two events, five days apart. Shall I draft separate gift ideas so nothing gets mixed up?"
2. Open **Sophie Miller**'s page — her chat log is on screen ("…it's been 16 days since we actually went out"). Agent flags it: "Sophie mentioned 16 days without a proper date. Friday looks open."
3. Quick pass over the graph view — ten people, their places, their events, connected.

**VO**:
> "It reads the calendar you actually keep: a wedding on the 2nd, Jeju on the 7th — and makes sure nothing collides. It even catches what Sophie said in passing: sixteen days since a real date."

## 1:40–2:12 · It remembers (upload → memory)

**Screen actions**:
1. In **Chanho ❤️ Hannah Brooks**, drag the egg tart photo (`dashboard/public/date/web/IMG_2569.jpg`) into the chat: "midnight natas 🥧". The agent files it — the record's Timeline gains **"2026-08-01 — Lisbon evening — midnight pastéis de nata"** on screen.
2. Ask: "What did we eat that night in Lisbon?" → the agent answers from the record it just wrote, photo attached, with a link to the **Chanho ❤️ Hannah** page.

**VO**:
> "Drop in a photo, and the agent files the memory — into this relationship's record, and nowhere else. Ask, and it answers from memory — not search."

## 2:12–2:48 · Finale: the other partner asks (the fun bit)

**Screen actions**:
1. Cut to **Ava's profile**. In **Chanho ❤️ Ava Thorne**, Ava types casually:
   > "Remember the egg tarts we had in Lisbon?"
2. The agent answers honestly — it has nothing to remember:
   > "I have no record of egg tarts. Or Lisbon. Not in this relationship."
3. Beat. Split-screen: Hannah's record shows the 🥧 memory · Ava's chat shows the blank. The pre-roll's promise, live.

**VO**: none — screen and captions carry it.
Closing caption: **"An agent that remembers also knows what never happened."**

## 2:48–3:00 · Closing

**Screen**: Graph view zooms out — ten "Chanho ❤️ …" nodes orbiting one very busy Chanho → title card.

**VO**:
> "Every person, every promise, remembered — human to human."

---

# Screen Transition Design

Global rules:

- Grammar: hard cuts inside a scene, one transition style per scene boundary, never stacked.
- The Relationships table is "home base" — every section departs from and returns toward it, so the viewer always knows where they are.
- Speed ramp: record real-time, edit at 1.2–1.5×; drop to 1.0× for every agent reply.

Per-boundary plan (the pre-roll is title cards only — no UI, so it has no in-app transition of its own):

1. **Pre-roll → Login (0:15)** — the Card-2 diagram fades to black 0.5s, then fade in 0.6s onto the login screen; the MetaMask signature lands and the **Relationships dashboard** fills the main page (hold ~2s). From home base, the cursor moves to the Chats **+** — the first gesture is reaching out.
2. **Invite → Consent (0:33)** — on Isla's *accept* the New-DM modal doesn't just close; its avatar **match-cuts into the freshly-created sidebar row** **Chanho ❤️ Isla Montgomery** (0.4s). The page is born from the invitation.
3. **Inside Consent** — on "consent granted," a soft radial pulse from the button (0.3s), then the agent bubble pops with the app's own 80ms pop-in.
4. **Consent → Manage (1:00)** — **match cut** on the agent avatar: chat bubble avatar aligns to the same position as the briefing card avatar. 0.4s crossfade.
5. **Inside Manage** — when the briefing highlights Olivia Aug 2 / Emma Aug 7, draw a thin underline animation across the two Event Date cells (0.3s each, staggered) — the data itself is the graphic.
6. **Manage → Remember (1:40)** — **whip pan** from Sophie's page to the agent chat (0.25s, motion blur): "turning to ask."
7. **Inside Remember** — as the agent quotes Isla, **push-zoom 110%** onto the quoted chat lines in her record for 1s, then settle.
8. **Remember → Egg tart (2:12)** — no transition. **Hard cut + kill the BGM.** Dry silence sets up the joke.
9. **The private message** — freeze 0.5s as 🔒 appears → zoom 130% into "Not in this relationship." → hold 1.5s of total stillness → cut to the Relationships table, where no row so much as blinks (the database's indifference is the punchline) → cut back.
10. **Egg tart → Closing (2:48)** — luma fade to white 0.8s into the graph zoom-out; warm BGM returns.
11. **Title card (2:56)** — graph nodes collapse into the logo dot (0.5s), title in, hold 2s, fade out.

Caption style: white on 60% black rounded backing, bottom-center; the private message keeps its own 🔒 bubble style. SNS 15-second cut = scenes 8–9 only, vertical crop on the chat panel with the untouched Relationships table picture-in-picture top-right.
