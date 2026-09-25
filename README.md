# ainmem

A workspace that remembers the conversations inside it.

**🌐 [ainmem.ainetwork.ai](https://ainmem.ainetwork.ai)** — sign in with Google.

Pages, databases and chat in one place, plus an agent per conversation that keeps a written
record of it. The memory is a folder of Markdown, not a vector store, and each conversation's
folder is reachable only by the people in it.

> **ETHGlobal Tokyo 2026 (World, Continuity):** the submission is
> [Relation Treasury](#relation-treasury--ai-manages-the-money-humans-approve-it) —
> what existed before the weekend and what was built during it is split out there.

## What it does

**Write.** A block editor with the usual page tree — headings, lists, toggles, code, tables,
callouts, embeds — plus databases (table/board/calendar views), comments, page-level sharing
and per-person invites. Every page is mirrored to Markdown on disk (`md-mirror/`), so the
content is readable without the app.

**Talk.** Direct and group conversations alongside the pages, with an AI chat panel for
one-off questions.

**Remember.** Invite an agent into a conversation and it starts keeping that conversation's
record: appending what was said to a document, answering questions from it with links back
to the original messages, and — when a draft contradicts the record — saying so before the
message goes out. Two built-in profiles shape what it keeps and how it speaks
([`agent/profiles`](app/src/lib/agent/profiles/)): `family` (Family timeline, Health & care,
Plans & chores, Family notes) and `business` (Decisions, Action items).

## The memory is a folder

Agent memory is **OKF** ([Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)) — the folder tree *is* the database. Each conversation gets one
bundle: Markdown files the agent appends to when it records, and reads back when it answers.
No embeddings, no separate index; `git diff` shows exactly what an agent decided to remember.

Isolation follows from that. A bundle is one folder gated by
[`okf_acl`](app/src/lib/okf-acl.ts), which registers the folder against its participants and
refuses every path under it to anyone else. So an agent in one conversation cannot open
another conversation's folder — not because a prompt tells it not to, but because the read
fails. That matters most in the failure mode this design exists for: one shared memory store
answers a friendly question with someone else's private detail, and nothing looks broken
while it happens.

## The agent is an A2A participant

Once provisioned, an agent is not an in-app special case. It publishes an agent card at
`/.well-known/agent-card.json` and speaks JSON-RPC `SendMessage` over
[A2A](https://a2a-protocol.org) at
[`/api/a2a/[agentUserId]`](app/src/app/api/a2a/%5BagentUserId%5D/route.ts), so any A2A client
reaches it the same way the in-app dispatcher does. Membership is authorized per member with
a Bearer token; knowing the URL is not enough.

[`relational-memory-mcp`](relational-memory-mcp/) exposes the same OKF surface as MCP tools,
so an external agent reads and writes the exact bundle the in-app agent does — through the
same ACL.

## Relation Treasury — AI manages the money, humans approve it

*ETHGlobal Tokyo 2026 · World — Best Use of World ID for Agents, Best IDKit Use Case (Continuity).*
[Demo script](docs/world/DEMO.md) · [integration debriefs](docs/world/debrief.md) ·
[integration log](docs/world/integration-log.md) · [plan](docs/world-relation-treasury-scenario.md)

Five friends pool $1,000 for a trip. The room's agent — the same agent that keeps the
relation's memory — holds the pot in its own wallet (Sepolia), and what it may do with it is
written in the relation's memory doc as plain sentences ("Shared expenses from $50 to $200:
2 verified members approve."). A money sentence in chat is matched by shape, the rules are
parsed by grammar and enforced by deterministic code, and every reply is a template that
quotes the rule it followed. No model decides anything about money
([`lib/agent/treasury/`](app/src/lib/agent/treasury/)).

**Two trust moments, two World surfaces, one credential each:**

| Moment | Surface | What it proves | Why it is the minimum |
|---|---|---|---|
| Becoming an approver (a *seat*), once per member | **IDKit** — action `treasury-seat`, signal = the room's id | Proof of Human (Orb) | The treasury needs exactly one fact about a member: one unique human, not the second account of someone already seated. A passport reveals name and nationality for nothing; Selfie Check is weaker against one person running several accounts — the attack on a group treasury. |
| Approving a critical action, every time | **World ID for Agents** — OIDC step-up at the sandbox IdP, `max_age=0`, `prompt=login` | A fresh sign-in by a unique human (pairwise `sub`); `auth_time` must postdate the request | The quorum counts distinct humans at the moment money moves, not a login from this morning. |

*Why both, not one.* The seat fixes the roster before any request exists: who is notified,
whether enough people could ever reach a bar ("only 2 of us hold a seat so far"), and it
anchors "one human, one seat" on the strongest uniqueness credential. The step-up proves
presence for one specific action; alone it would let any account holder vote, and a seat
alone would let a hijacked session approve. Before the IdP, the app shows its own
confirmation page — amount, payee name and address, requester, the rule, who approved so
far — because the IdP screen cannot say what is being approved.

**Denied paths** (all asserted by the e2e): a request the rules forbid is refused without
asking anyone (the personal-wallet rule); a second account of the same human is voided; an
unseated member, a stale proof, a cancel at the IdP, and an outsider count for nothing.
Requests lapse after 24 hours; a request that reaches its quorum is re-checked against the
rules and balance in force at that moment before anything moves.

**"Can Alex just edit the rules?"** The doc is editable by every member, so an edit is a
proposal: the agent enforces the version the relation *adopted*, recorded in the database.
"@agent adopt the new rules" puts the edited Rules, Payees and any new members to a vote at
the strictest bar the rules name (never fewer than 2). Members who joined after the adoption
don't vote or direct money until the relation adopts them.

**Trust model — what this is and isn't.** The treasury is a custodial agent EOA on Sepolia
at a disclosed demo scale ($200,000 per ETH, so $1,000 is 0.005 SepETH). Rules, seats and
quorum are enforced by this server; the key is sealed at rest (AES-256-GCM under
`SESSION_SECRET`), so a database dump alone moves nothing, but whoever runs the server can
sign. The ledger of record is the `treasury_actions` table the panel reads; the *Treasury
Activity* page is the agent's narrative in the shared memory. On testnet the demo payee
("Hotel Gracery Shinjuku") is the faucet account that funded the treasury, so rehearsals
recycle the same SepETH. Next step: move enforcement on-chain — a Safe module or guard that
executes only with the server-attested approvals.

*Why not a multisig.* A Safe counts keys; this counts humans. Approvers hold no keys (a
World ID verification is the approval), one person with five accounts is still one vote,
and the policy is the relation's own sentences, which the agent reads, applies and cites.

**What has been exercised, honestly.** The e2e ([`app/e2e/treasury.check.mjs`](app/e2e/treasury.check.mjs))
plays the whole journey over HTTP against the **local mock** of the World ID for Agents IdP
and moves real Sepolia ETH (8/8). The real sandbox IdP and a Developer Portal staging app for
IDKit need client registration, which is a manual step — see the pre-flight in
[DEMO.md](docs/world/DEMO.md); without them the panel labels itself "mock IdP" / "dev seat".

**Pre-existing vs built this weekend.** The weekend's commits are `4d4612d..HEAD` (the
treasury, the World step-up, the panel, the seed and e2e, the docs); everything else
predates 2026-09-25.

| Pre-existing | Built this weekend |
|---|---|
| World ID 3.0 personhood for relation consent (July): [`lib/worldid.ts`](app/src/lib/worldid.ts), [`world-id-button.tsx`](app/src/components/dm/world-id-button.tsx), the consent route's nullifier binding, `personhood_proofs` | [`lib/agent/treasury/*`](app/src/lib/agent/treasury/) — rules parser and evaluator, command matcher, memory reader, wallet, approvals/quorum/adoption, the agent's skill |
| Relation agents and their memory (July): [`provision.ts`](app/src/lib/agent/provision.ts), [`respond.ts`](app/src/lib/agent/respond.ts), OKF folders ([`okf-store.ts`](app/src/lib/okf-store.ts), [`okf-docs.ts`](app/src/lib/agent/okf-docs.ts)), demo login | World ID for Agents step-up: [`lib/auth/world.ts`](app/src/lib/auth/world.ts), [`api/auth/world/*`](app/src/app/api/auth/world/) (confirmation page, callback), the local mock IdP [`api/world-mock/*`](app/src/app/api/world-mock/) |
| AgentKit wallet wrapper ([`agentkit.ts`](app/src/lib/agent/agentkit.ts), July); the songpyeon purchase demo ([`spend.ts`](app/src/lib/agent/spend.ts), Sep 23 — it now refuses a treasury agent) | IDKit v4 seats: [`lib/worldid-v4.ts`](app/src/lib/worldid-v4.ts), the seat and rp-context routes, [`seat-button.tsx`](app/src/components/treasury/seat-button.tsx) |
| [`secret-box.ts`](app/src/lib/secret-box.ts), the family wallet in [`gift.ts`](app/src/lib/gift.ts) (Sep 25, before the treasury) | The panel ([`treasury-panel.tsx`](app/src/components/treasury/treasury-panel.tsx)), the `treasury_*` tables and `users.world_sub`, the seed, selftest and e2e, [`docs/world/`](docs/world/) |

*A note on the history:* the eight treasury commits `aa9fc39..a4c81bb` carry the same
second (2026-09-25 15:10:57 UTC) — one working session was split into these units and
committed together, not committed as each unit was finished; the integration log carries a
matching note about its times. The pushed history is left as it is.

**Run it** (after the setup under [Running it](#running-it); needs `RELAYER_KEY` or
`DEPLOYER_KEY` with a little Sepolia ETH, and `WORLD_IDP=mock` for the local IdP):

```bash
cd app
npx tsx --tsconfig scripts/tsconfig.json scripts/seed-tokyo-trip.mts --reset   # the room, rules, $1,000
npx tsx --tsconfig scripts/tsconfig.json scripts/treasury-selftest.mts         # parser + matcher, no chain
node e2e/treasury.check.mjs                                                     # the journey; spends ~0.002 SepETH
```

## Family Vault — a time capsule that pays interest (demo)

[`family-vault/`](family-vault/) extends the workspace with a family-savings
demo on 1inch Aqua: parents deposit $1,000 for their child with a sealed
letter in the workspace; a **custom SwapVM** (two new operators:
`_timeCapsule`, `_lowRiskGuard`) runs it as low-risk liquidity for 18 years;
at maturity the child's `claim()` moves principal + spread on-chain and the
same event unlocks the letter — the money and the message arrive together.
Custody never leaves the family's own vault contract.

Building it also added general dashboard features to the workspace (counter
formatting, chart and depth widgets — each with an e2e check) and a first
iteration, a [swap journal](aqua/).

## Architecture

A workspace is a team. Conversations form between its members, each with its own agent and
its own memory bundle.

```mermaid
flowchart TB
    subgraph WS["🏢 workspace (a team)"]
        direction LR
        BD(["👤 BD"])
        MK(["👤 Marketing"])
        DV(["👤 Dev"])
    end

    subgraph REL1["💬 BD ⇄ Dev"]
        A1["🤖 A2A agent"]
    end
    subgraph REL2["💬 Marketing ⇄ Dev"]
        A2["🤖 A2A agent"]
    end

    BD --> REL1
    DV --> REL1
    MK --> REL2
    DV --> REL2

    A1 -->|"MCP tools"| M1["🔌 relational-memory-mcp"] -->|"okf_acl gated"| O1["📁 OKF bundle<br/>BD–Dev"]
    A2 -->|"MCP tools"| M2["🔌 relational-memory-mcp"] -->|"okf_acl gated"| O2["📁 OKF bundle<br/>Marketing–Dev"]

    A1 -. "⛔ no path" .-x O2
    A2 -. "⛔ no path" .-x O1

    style WS fill:#f8fafc,stroke:#64748b,stroke-width:2px
    style BD fill:#e0e7ff,stroke:#4f46e5,color:#111
    style MK fill:#e0e7ff,stroke:#4f46e5,color:#111
    style DV fill:#e0e7ff,stroke:#4f46e5,color:#111
    style REL1 fill:#fdf2f8,stroke:#db2777,stroke-width:2px
    style REL2 fill:#fdf2f8,stroke:#db2777,stroke-width:2px
    style A1 fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#111
    style A2 fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#111
    style M1 fill:#dbeafe,stroke:#2563eb,color:#111
    style M2 fill:#dbeafe,stroke:#2563eb,color:#111
    style O1 fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#111
    style O2 fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#111
```

Dev is in two conversations and gets two agents. What BD shared with Dev never reaches the
Marketing ⇄ Dev bundle — the crossed-out paths are the design, enforced in the filesystem
rather than in a prompt.

**Stack.** Next.js 16 (App Router) · Postgres via Drizzle · iron-session · any
OpenAI-compatible endpoint for the LLM · Playwright for e2e. Production runs as a container
behind nginx; see [`docs/deployment.md`](docs/deployment.md).

## Running it

```bash
cd app
cp .env.example .env.local     # POSTGRES_URL, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET, OKF_ROOT
pnpm install
pnpm db:push                   # apply the schema
pnpm dev                       # http://localhost:3110
```

Sign-in is Google OAuth, so a client ID is needed even locally: register
`http://localhost:3110` as an authorized origin and
`http://localhost:3110/api/auth/google/callback` as the redirect URI. Google only accepts
`http` for `localhost` — developing on a remote host means tunnelling
(`ssh -L 3110:localhost:3110 …`) rather than browsing to its LAN address.

Without an LLM endpoint the app still runs: pages, chat and sharing are unaffected, the
agent records deterministically, and only the AI answering paths fail.

## Where things are

| Path | What |
|---|---|
| [`app/src/app`](app/src/app) | routes — pages, DMs, API |
| [`app/src/lib/agent`](app/src/lib/agent) | the recording pipeline, answering, the send-guard |
| [`app/src/lib/okf-store.ts`](app/src/lib/okf-store.ts) · [`okf-acl.ts`](app/src/lib/okf-acl.ts) | the memory files and who may read them |
| [`relational-memory-mcp`](relational-memory-mcp/) | the MCP server over the same bundles |
| [`docs/deployment.md`](docs/deployment.md) | how production is put together, and what has bitten us |

## Why build it this way

Most agents stand in for a person: they answer for you, decide for you, and gradually push
the other person out of the loop. This one has no self to speak from. It sits between people,
holds only what they made together, and cannot carry any of it elsewhere — the boundary is a
folder permission, not a promise.
