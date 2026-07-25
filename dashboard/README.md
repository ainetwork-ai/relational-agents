# Relationship Agent Dashboard (hackathon)

A standalone dashboard on top of the Notion clone. The Notion app is the data
store: the girlfriends database is a plain CSV (`Relationships.csv`) inside the
OKF store (`NOTION_FS_ROOT`, default `../notion-fs`), editable as a normal
Notion table. This server reads the same file and derives everything live —
no schema, no database, no dependencies.

**Core idea:** people are nodes, relationships are edges. The agent only ever
derives from a single edge (row), so it cannot hallucinate one partner's
dates onto another.

## Run

```bash
node server.mjs            # → http://localhost:3110
```

Environment (all optional):

| var | default | meaning |
|---|---|---|
| `DASH_PORT` | `3110` | server port |
| `NOTION_FS_ROOT` | `../notion-fs` | the Notion clone's OKF content root |
| `NOTION_APP_URL` | `http://localhost:3000` | the Notion clone, for deep links |

On first run, if no CSV named like `Relationships`/`girlfriend` exists in the
store, a demo one is seeded **with dates relative to today**, so birthday /
anniversary / contact-gap alerts always fire during a demo.

## What's on the dashboard

- **Notifications** — upcoming birthdays, her important events, 100-day
  anniversaries, contact/date gaps. Click one to jump to the card.
- **Cards** — one per relationship: heart colored by level (white → deep red,
  Lv.0 Total Stranger → Lv.7 Almost Married), met date + D+n, birthday D-day,
  last contact / last date, the agent's suggested actions, and Message / Call
  buttons. The ↗ link opens the same row in the Notion app.
- **Messenger tab** — conversations mirror the database; chat is a local demo
  shell (canned replies) until the real messenger lands.

## Data columns

`Name, Level (0-7), Met, Birthday, Last Contact, Last Date, Phone,
Upcoming Event, Event Date, Notes` — dates are `YYYY-MM-DD`. Column matching is
by header name, order-independent; extra columns are ignored. Edit rows in the
Notion table (or the CSV directly) and the dashboard reflects it on refresh
(auto-refreshes every 30s and on window focus).
