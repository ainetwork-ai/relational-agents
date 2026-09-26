---
title: "Demo — Nurisoft Sales Team: three phones' call logs become one pipeline"
---

# Three phones' call logs become one sales pipeline, with a single sentence

**Three salespeople's phones upload their call history to their own aindrive every time a call
ends. Connect those three folders to the teamspace, and in the team chat a single message to the
agent — "build a unified sales pipeline" — creates a pipeline broken down by account.**

Sales status is always scattered across people's heads and their individual phones. Daehan
Trading was first contacted by Assistant Manager Kim, and the negotiation is now being handled by
the team lead, so looking at either phone alone only shows half the picture. This demo shows how
those scattered calls become a single pipeline.

## The cast and their phones (aindrive)

| Person | aindrive account | Phone = drive | Call history |
|---|---|---|---|
| 👔 Team Lead Park Jihoon | wallet account | "Park Jihoon's phone · Galaxy Z Fold7" | Daehan Trading proposal/negotiation, Taeyang Construction, Cheongsol Hospital, Hangyeol Logistics site-visit schedule — 7 calls |
| 👩‍💼 Manager Lee Seoyeon | wallet account | "Lee Seoyeon's phone · iPhone 16" | 4 calls through the Seojin Foods contract, Miraejeongmil, Hangyeol Logistics, dentist appointment (personal) — 9 calls |
| 🧑‍💼 Assistant Manager Kim Minjun | wallet account | "Kim Minjun's phone · Galaxy S25" | Daehan Trading lead sourcing, Seojin Foods technical support, Ocean Market, Green Farm, mom (personal) — 8 calls |

Each call is one markdown file: `call-history/2026-09-23 11-20 Jeong Woosung (Daehan Trading
Purchasing Manager).md`. The header holds device, outgoing/incoming, counterpart, number, start
time, and call duration; the body holds a summary and the transcript (source:
`app/demo/sales-calls/`).

All three sign in to ainmem via "Sign in with aindrive," and right after sign-in the screen
**"Which aindrive folder would you like to share with the team?"** lets each of them pick their
phone's drive and share it with the "Sales Team 1" teamspace (their own drive list comes from the
aindrive MCP's `list_drives`, and ownership is also checked via the MCP under their own account's
permissions). The shared folder can then be opened by any teammate from the sidebar teamspace and
from **+ → Import from aindrive**'s "Folders shared with the teamspace" — read access follows the
sharer's permissions, and going into aindrive directly still won't open someone else's drive.
Sharing more folders later is done from the sidebar AINDRIVE's **Share with team**.

## Setup (once)

```bash
cd app
# 1) Three people: aindrive account (wallet) + phone drive (aindrive CLI) + ainmem account
pnpm demo:sales:accounts     # --data defaults to demo/sales-calls
# 2) Workspace "Nurisoft Sales Team": teamspace, three phones connected, home page, team chat + agent
pnpm demo:sales              # use --reset to rebuild
```

Keys, drive folders, and CLI logs live in `~/.ainmem-demo/` (`sales-keys.json`,
`sales/drives/<kim|lee|park>/`, `sales/cli/<key>/aindrive.log`). If `DEMO_LOGIN_ADDRESS` is set,
"Start with demo account" signs in as Team Lead Park Jihoon.

The pipeline is **not pre-built** — having the agent build it live is the point of the demo.

## Demo flow (about 3 minutes)

### 0:00 · Sales Team 1 home — the teamspace with three phones connected
**Sales Team 1 Home** has the three people's recent calls linked in via aindrive. Opening one
shows a preview of the summary and transcript. Clicking the teamspace's aindrive indicator shows
the three phones connected.
> "The call history lives on each person's phone (aindrive). We've only connected them."

### 0:40 · Team chat — "@agent build a unified sales pipeline"
The **Sales Team 1** chat room. The assistant manager doesn't know how Daehan Trading turned out,
the manager is bragging about the Seojin Foods contract, and the team lead wants to see it all at
once. The team lead types:

```
@agent build a unified sales pipeline
```

The agent first says "Found 24 calls across 3 aindrive drives," reads them one by one, and then
posts the result (roughly a minute with a local model):

- 24 calls → 8 accounts, **2 calls unrelated to sales excluded (mom, dentist)**
- Negotiation: Taeyang Construction 150M, Daehan Trading 108M · Proposal: Ocean Market · Needs
  assessment: Hangyeol Logistics, Miraejeongmil, Green Farm
- Contract closed: Seojin Foods 48M · On hold: Cheongsol Hospital

### 1:40 · Unified Sales Pipeline page
Clicking the link in the reply opens the **Unified Sales Pipeline** page in the teamspace.
- **Stage board**: each card shows amount, owner, next action, and deadline. The Daehan Trading
  card lists both Kim Minjun and Park Jihoon as owners — calls that had been split across their
  two phones are now one line.
- **Dashboard**: account count, total projected amount, bar/donut charts by stage.
- **Upcoming schedule**: from the 9/29 Miraejeongmil demo through the 10/7 Taeyang Construction
  executive presentation, as to-dos.
- **Source calls**: each account has a toggle with the original call files (aindrive links) inside
  — every number has a source.
> "No one filled out a spreadsheet. The calls are the pipeline."

### 2:30 · When a new call comes in
Simulate Assistant Manager Kim's phone just having uploaded a call that ended moments ago:

```bash
cp "app/demo/sales-calls-new/kim/"*.md ~/.ainmem-demo/sales/drives/kim/call-history/
```

Say "@agent update the pipeline" again. The same page is rebuilt, and Green Farm moves from needs
assessment (8M) to **proposal, 9M**. Deleting that file after the demo returns things to the
starting state.

### 2:50 · Wrap-up — from a file to aindrive
On the page, pressing **+** shows **Import from aindrive** at the top of the menu. Selecting it
opens the aindrive file picker right away, and it lets you pick not just your own phone's files
but also, via "Folders shared with the teamspace," a teammate's phone's call files. Files are
brought in as links, not copies. The teamspace's OKF backup accumulates in Park Jihoon's phone's
`ainmem-sales-team-1-…/` folder — the pipeline page along with it.

## Things to check

- All three phones' calls are read (each folder under the account of the person who connected it)
- Personal calls do not go into the pipeline
- Accounts multiple people called are merged into one line, with everyone listed as an owner
- Asking again refreshes the same page (the link in the chat stays valid)
- The first item in the `+` menu is "Import from aindrive"
- Signing in with aindrive shows the screen for picking which folder to share (skipped if
  everything is already shared)
- Folders a teammate has shared open in the import picker; someone else's unshared drive still
  doesn't open
