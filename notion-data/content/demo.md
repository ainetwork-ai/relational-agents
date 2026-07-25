---
title: Demo — 3-Minute Video Script & Transition Design
icon: 🎬
---

# I relate, therefore I am.

**An agent is born only when two people agree.**

Total runtime 3:00 · 1440×900 · light mode.
Concept: a relationship-management workspace. The star is the relational agent — born only by mutual consent, it manages and remembers your relationships. All scenes below use the REAL data in this workspace: the **Relationships** database (Relationships.csv) and the **Relationship Records** pages — every record titled **"Chanho ❤️ {name}"** (Chanho ❤️ Isla Montgomery, Chanho ❤️ Hannah Brooks, Chanho ❤️ Sophie Miller, and seven more).

Setup: logged in as **Chanho**, sidebar on the **Chats** tab, Relationships table one click away. Warm up the local LLM once before recording.

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

## 0:15–0:33 · Opening — an invitation, not a page

**Screen actions**:
1. Sidebar, **Chats** tab. In the **Direct messages** section, click the **+**. The **New direct message** modal opens with the member list.
2. Pick **Isla Montgomery** and send the first hello. A pending invite appears — "waiting for Isla."

**VO**:
> "This doesn't start with a page. It starts with an invitation. Chanho reaches out to Isla — one message, and the door is open."

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

## 1:40–2:12 · It remembers (quotes the records)

**Screen actions**:
1. Ask: "What was Isla's take on the November tournament?" → agent quotes her page verbatim — "the november dates are a bit tight… the finals moved to the 12th works for me" — with a link to the **Chanho ❤️ Isla Montgomery** record.
2. Ask: "What does Hannah study again?" → "Marine biology — PhD. You met on a blind date. Last topic: the deep-sea vent documentary. She said tube worms are 'efficient, not nightmares.'"

**VO**:
> "Ask, and it answers from memory — not search. Who said what, where you met, and which joke landed."

## 2:12–2:48 · Finale: a loyal agent (the fun bit)

**Screen actions**:
1. Chanho opens **Chanho ❤️ Hannah Brooks** and types casually into the agent chat:
   > "Remember the egg tarts we had in Portugal?"
2. Instead of replying in the open, a **🔒 private message** appears — visible only to the owner:
   > 🔒 "Chanho, I have no record of egg tarts. Or Portugal. Not in ❤️ Hannah — not in any of your ten ❤️ pages. …Are you sure about this woman?"
3. Beat. Chanho: "…never mind." → Agent: "I will pretend this conversation never happened."

**VO**: none — screen and captions carry the joke.
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

1. **Pre-roll → Invite (0:15)** — the Card-2 diagram fades to black 0.5s, then fade in 0.6s onto a near-empty Chats sidebar; the cursor moves straight to the **+**. No table yet — the first gesture is reaching out.
2. **Invite → Consent (0:33)** — on Isla's *accept* the New-DM modal doesn't just close; its avatar **match-cuts into the freshly-created sidebar row** **Chanho ❤️ Isla Montgomery** (0.4s). The page is born from the invitation.
3. **Inside Consent** — on "consent granted," a soft radial pulse from the button (0.3s), then the agent bubble pops with the app's own 80ms pop-in.
4. **Consent → Manage (1:00)** — **match cut** on the agent avatar: chat bubble avatar aligns to the same position as the briefing card avatar. 0.4s crossfade.
5. **Inside Manage** — when the briefing highlights Olivia Aug 2 / Emma Aug 7, draw a thin underline animation across the two Event Date cells (0.3s each, staggered) — the data itself is the graphic.
6. **Manage → Remember (1:40)** — **whip pan** from Sophie's page to the agent chat (0.25s, motion blur): "turning to ask."
7. **Inside Remember** — as the agent quotes Isla, **push-zoom 110%** onto the quoted chat lines in her record for 1s, then settle.
8. **Remember → Egg tart (2:12)** — no transition. **Hard cut + kill the BGM.** Dry silence sets up the joke.
9. **The private message** — freeze 0.5s as 🔒 appears → zoom 130% into "Not in any of your ten ❤️ pages." → hold 1.5s of total stillness → cut to the Relationships table, where no row so much as blinks (the database's indifference is the punchline) → cut back.
10. **Egg tart → Closing (2:48)** — luma fade to white 0.8s into the graph zoom-out; warm BGM returns.
11. **Title card (2:56)** — graph nodes collapse into the logo dot (0.5s), title in, hold 2s, fade out.

Caption style: white on 60% black rounded backing, bottom-center; the private message keeps its own 🔒 bubble style. SNS 15-second cut = scenes 8–9 only, vertical crop on the chat panel with the untouched Relationships table picture-in-picture top-right.
