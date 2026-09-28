# AINMEM

**Don't sell your old phones. Make them your family's server.**

AINMEM connects family memories through [aindrive](https://github.com/ainetwork-ai/aindrive)
and helps a relationship agent keep learning from them over time. Photos, recipes and call
recordings can stay on the devices that hold them. The family chooses which folders to share;
the agent turns those sources into a shared, lasting record.

The goal is **P2P memory across family-owned devices**: replacing a phone should not mean
starting the family's agent memory over. An old phone can become a home for the memories the
family still uses, alongside the phones they carry today.

[Try the family demo](https://ainmem.ainetwork.xyz) · [Walkthrough](docs/demo.md) ·
[relational-agents source](https://github.com/ainetwork-ai/relational-agents) ·
[aindrive source](https://github.com/ainetwork-ai/aindrive) ·
[AIN-UI source](https://github.com/ainetwork-ai/AIN-UI)

## A drawer full of family memory

We replace our phones every year or two. We move files over, fill the new phone again, and
leave the old one in a drawer or sell it. Years of photos and calls become hard to find.
A cloud subscription gives us more storage, but it does not tell us where Grandma explained
her recipe or which recording contains the plans we made together.

AINMEM brings those memories back into use. aindrive makes a device's selected folders
available to the family agent. AINMEM organizes what the family shares into recipes, albums,
tasks and a written memory the family can revisit. The workspace is where people read and
use that memory.

### Grandma's kimchi, five years later

This is the experience we are building toward:

Five years ago, Grandma explained her kimchi over the phone. The recording stayed on her old
phone in a drawer. Plug the phone back in, share the folder, and ask the family agent:
**“How did Grandma make her kimchi?”** The agent finds the shared recording and its transcript,
then turns that knowledge into a recipe and shopping list the family can use.

Grandma can choose to offer the recipe outside the family too: **1 USDC on Base through x402**,
paid to her wallet, with the source file served by her device. The same memory can be private
within the family or offered through a paid share she controls.

**Her memories. Her device. Her price.**

The current [family demo](docs/demo.md) exercises the underlying pieces with Grandma's recipes,
recording transcripts, photo albums and paid gifts. The kimchi story describes how these
pieces fit together; it is not a claim that this exact recording or phone setup ships in the seed.

## How memory continues

1. **Keep the source on its device.** Connect a folder through aindrive. Linked files are read
   from the connected drive on demand; they do not need to be imported into ainmem first.
2. **Choose who shares it.** Connect a whole drive or a selected folder to a family teamspace.
   Private groups can have their own sources, such as a birthday plan hidden from Grandma.
3. **Ask across the shared folders.** The assistant panel and room agent read the sources
   available to that conversation and identify the files behind their answers.
4. **Build useful memory.** Turn recipes into shopping lists, transcripts into tasks, and
   photos into albums. After consent, the room's agent also keeps a sourced written record of
   conversations. Pages and databases can be exported as prompts for other agent workflows.
5. **Keep a readable copy.** Relationship memory is stored in OKF Markdown files. Teamspace
   pages and databases can be backed up as Markdown and CSV to a connected aindrive folder.
   Source files and saved records give future sessions something to return to.

A device going offline makes its live source files unavailable. Records and backups already
created from those files can remain; disconnecting a device does not erase earlier memories.

### What runs where today

The P2P home-server experience is the product direction. The current integration has these
concrete deployment requirements:

| Part | Current implementation |
|---|---|
| Source files | Served from connected devices through aindrive; aindrive now includes Android and Mac device hosts as well as the CLI |
| File access | ainmem calls the configured aindrive server over MCP/HTTP; aindrive bridges requests to its connected devices |
| Workspace and agent runtime | A Next.js server with PostgreSQL and a writable OKF directory |
| AI inference | AINMEM uses a configurable model endpoint. aindrive also has on-device agents on Android and Mac, with remote-agent handoff paths |
| Memory persistence | Room bundles on the app host; eligible teamspace content can be backed up to linked drives |

Use a model running on your own hardware to keep inference there. A hosted endpoint or remote
agent receives the content sent or granted to it; aindrive supports cloud handoff when its local
agent cannot answer, so not every chat path stays on-device. The repository does not yet establish a phone-only,
server-free deployment or direct phone-to-phone transport for all ainmem operations. Wallet and
aindrive sign-in make Google OAuth optional; the app still maintains identities and permissions.

## The family workspace

Pages, databases and chat make the connected memory usable day to day:

- **Read and organize:** a block editor, page tree, table/board/calendar views, comments,
  sharing and invites. PostgreSQL workspace pages also have a Markdown mirror on disk.
- **Find and create:** an assistant dock and `@agent` in chat for shared-folder questions,
  shopping lists, transcript-based to-dos, EXIF albums and photo-caption searches.
- **Remember together:** consented conversations become sourced OKF records. `family` keeps
  a timeline, care, plans and family notes; `business` keeps meetings, agreements, actions and
  contacts. The [profiles](app/src/lib/agent/profiles/) define both.
- **Reuse knowledge:** page/database prompt export through the UI,
  [`/api/pages/[pageId]/prompt`](app/src/app/api/pages/%5BpageId%5D/prompt/route.ts) and MCP.
  Generated prompt pages preserve the sources' access restrictions.
- **Share on your terms:** folder permissions, private teamspaces, file previews, x402 gifts
  and paid-file access, with [AIN-UI](#ain-ui--shared-file-and-payment-surfaces) providing shared
  file and payment surfaces across the app.

In the hosted demo, use “Sign in with aindrive” or “Start with the demo account” (Mom).
“As another family member” switches to Grandma, Dad or Seoyeon.

## Persistent agent memory: files, sources and permissions

Relationship memory uses **OKF (Open Knowledge Format)**: folders contain Markdown pages, and CSV files represent
databases. [`okf-store.ts`](app/src/lib/okf-store.ts) reads and writes these files directly under
`OKF_ROOT`. The memory pipeline appends sourced entries to each room's bundle without an
embedding index. The app does not automatically commit these files to Git.

Only post-consent messages enter the shared room record; agent messages and private agent
exchanges are excluded. DMs record each message, while agent-lab rooms use a batch threshold
(default 10) or an idle delay (default 120 seconds). The send-guard checks drafts against the
record, cites evidence and lets the human decide whether to send.

The aindrive backup exports eligible teamspace pages and databases. It is not a complete
replica of the app's PostgreSQL state or every room's restricted memory bundle. Moving the
agent runtime still requires preserving its database, OKF files and applicable file storage.

The app has several storage layers:

| Data | Where it lives |
|---|---|
| Users, workspaces, chat, normal pages and blocks, database state, ACLs, approvals | PostgreSQL via Drizzle |
| Relationship memory and file-backed pages/databases | `OKF_ROOT` (defaults to `app/okf-fs/` when run from `app/`) |
| Export of PostgreSQL workspace pages | `MD_MIRROR_ROOT` (defaults to root `md-mirror/`); a derived export |
| Uploaded bytes | Local disk, or MinIO when configured; [storage setup](docs/object-storage.md) |
| Linked aindrive files and teamspace backups | The connected drive, accessed through its owner's account |

[`okf_acl`](app/src/lib/okf-acl.ts) stores path restrictions in PostgreSQL and checks them in
application read/write paths. Registered paths and their descendants are restricted to listed
members; unregistered paths are shared under the surrounding API's access rules. PostgreSQL
pages have separate page/workspace membership checks. This is application-level authorization:
raw filesystem access bypasses it. Restoring memory therefore requires both the files and the
PostgreSQL authorization state. Back up uploaded bytes separately too.

## A2A and MCP

A provisioned agent exposes its public card at **`GET /api/a2a/<agentUserId>`** and accepts
JSON-RPC `SendMessage` (also `message/send`) at **`POST` on that same URL**.
[`The route`](app/src/app/api/a2a/%5BagentUserId%5D/route.ts) requires a member Bearer token
or the configured `A2A_SERVICE_TOKEN` for messages. The built-in dispatcher calls local agents
in-process; it sends HTTP A2A requests to external bots.

There are two MCP interfaces:

- **[`/api/mcp`](app/src/app/api/mcp/route.ts)** — Streamable HTTP for OKF, page/prompt,
  aindrive and gift tools. It accepts a session cookie or agent Bearer token. The optional
  `MCP_SERVICE_TOKEN` gives public read-only access, not participant-only memory or mutations.
- **[`relational-memory-mcp/`](relational-memory-mcp/)** — a separate stdio REST wrapper for
  pages, blocks, databases, chat and OKF. It signs in as a user and inherits REST access checks.
  Set `MEMORY_BASE_URL=http://localhost:3110`; the wrapper's legacy default is port 3000.

## AIN-UI — shared file and payment surfaces

[**AIN-UI**](https://github.com/ainetwork-ai/AIN-UI) extends A2UI v0.9 with file grids, tiles,
previews, breadcrumbs, uploads and x402 payment cards. ainmem's integration uses `ain-ui@0.2.3`
and its `AinuiSurface` React renderer to display UI messages produced by aindrive. The package
supports MCP, AG-UI and A2A transports; this integration consumes aindrive MCP metadata and
paid-share HTTP responses.

The integration is merged into main. It covers drive pages, sidebar navigation, account and
folder-sharing forms, file pickers, editor attachments/albums/gifts and paid-file cards.
See the [component guide](app/src/components/ainui/README.md) for host rendering and checks.

- **Drive browser:** [`AinuiDriveBrowser`](app/src/components/ainui/drive-browser.tsx) renders
  producer-supplied surfaces in the linked-folder browser. Actions pass through
  [`POST /api/ainui/aindrive`](app/src/app/api/ainui/aindrive/route.ts), which calls aindrive's
  `a2ui_action` MCP tool with `X-AINUI: 1` and reads `_meta["ai.aindrive/a2ui"]`.
- **Access and file actions:** the host checks the session, shared-folder membership and paid
  file entitlement before forwarding actions as the connecting account. The
  [action boundary](app/src/lib/ainui-boundary.ts) restricts drive IDs, linked-root paths and
  allowed actions. It blocks traversal, deletion of the linked root and writes to managed
  backup paths. The route caps the JSON request body at 12 MiB.
- **Private assets:** the renderer resolves asset references through the authenticated
  `/api/aindrive/raw` and `/api/aindrive/thumb` routes, with download and cache-version parameters.
- **Paid files:** [`FileShareCard`](app/src/components/aindrive/file-share-card.tsx) renders
  aindrive's payment messages. An explicit payment action selects the wallet account and uses
  the [`ain-ui/x402` adapter](app/src/lib/wallet/x402.ts) to sign. The sale route sends the
  resulting `PAYMENT-SIGNATURE` to aindrive for settlement and unlock. Rendering a card does
  not initiate a payment.
- **Folder chat:** the current folder has an `AinuiFolderChat` panel with streamed replies,
  Stop and context reset when folders change. The [relay](app/src/app/api/ainui/folder-chat/route.ts)
  uses the current user's connected account. For shared links, only the link creator can
  export context to a remote agent. Picker mode omits chat and rejects write actions.
- **Gallery and navigation:** responsive tiles keep square media and two-line names. Counts
  describe the current listing; refresh preserves the current folder and view.
- **Compatibility:** aindrive must return AIN-UI messages; otherwise the integration reports
  that the server needs an update. [Folder-chat setup](docs/ainui-folder-chat.md) documents
  the upstream agent configuration and streaming contract.

The [boundary self-test](app/scripts/ainui-boundary-selftest.ts) covers path confinement,
drive identity, the action allow-list and managed backups:

```bash
cd app
pnpm exec tsx scripts/ainui-boundary-selftest.ts
node scripts/folder-chat-selftest.cjs
```

## Shared memory can also govern shared money

**Relation Treasury** extends the relationship-memory model to a shared pot and the rules its
members adopt.

*ETHGlobal Tokyo 2026 · World — Best Use of World ID for Agents, Best IDKit Use Case (Continuity).*
**The submission is [`world/`](world/)**: what it does, every World piece with its file and
function, what gets refused, what has been exercised, and what existed before the weekend vs
what was built during it. Live, with a copy of the room anyone can enter:
[ainmem.ainetwork.xyz/world](https://ainmem.ainetwork.xyz/world).

Shared money comes with an agreement — who may spend it, on what, how many must say yes — and
the wallet doesn't know any of it. Here the agent that already keeps a relation's memory holds
the pot and follows the agreement the members wrote into that memory, sentence by sentence.
World proves that each approval is a distinct human, present now: **IDKit** (Proof of Human)
gives each member one vote, and **World ID for Agents** (a fresh OIDC step-up) is needed for
spends requiring fresh approval. A deterministic parser enforces the **adopted** rules;
unsupported rule text blocks execution. The [treasurer](app/src/lib/agent/treasurer/) does use
an LLM to choose tools and explain results, but the tools enforce membership, approval and
spending limits on the server. The Treasury pages show accounts, rules, pending approvals,
activity and a chat with this treasurer.

[Demo script](world/DEMO.md) · [integration debriefs](world/DEBRIEF.md) ·
[integration log](world/integration-log.md) · [plan](world/plan.md)

## Recurring buy — a weekly ETH buy on Uniswap the members approve once

*ETHGlobal Tokyo 2026 · Uniswap Foundation — Best Uniswap Stack Contribution (Continuity).*
**The submission is [`uniswap/`](uniswap/)**: every Uniswap call with its file and line — the
standalone package and the recurring buy in the app — what existed before vs what was built this
weekend, and [`FEEDBACK.md`](uniswap/FEEDBACK.md).

Inside a Relation Treasury a member asks the agent for a recurring buy; the relation's rules decide
how many verified humans must approve it with World ID; after that a member can ask the agent
to buy, at most once per week inside those terms — USDC → WETH on Base, from its own wallet — and runs are shown in its history. Any human member
can stop it without a vote. The swap is [`invest.ts`](app/src/lib/agent/treasury/invest.ts), the weekly
authority [`recurring.ts`](app/src/lib/agent/treasury/recurring.ts), and the Treasury page shows the
agent's wallet per chain with every swap.

**There is no automatic weekly scheduler in the app.** A member triggers a run through chat or
the recurring-buy action. Real runs require `TREASURY_INVEST=uniswap-base` and
`TREASURY_RECURRING_REAL=1`; otherwise runs are rehearsals that move no funds. The standalone
`uniswap/` package uses EIP-712 signed mandates and a JSON passbook; the app uses World ID
approvals and PostgreSQL records.

With `UNISWAP_API_KEY`, buys first request a route from the Uniswap Trading API. The direct
v3 QuoterV2/SwapRouter02 path is a fallback only before a transaction or order is submitted.
Members can also authorize recurring contributions through Permit2, with bounded plan totals,
start/stop controls and a contribution history. See [Uniswap integration](uniswap/README.md).
How it was submitted, demoed and pitched: [ETHGlobal Tokyo 2026](docs/ethglobal-tokyo-2026.md).

### Family identity and sending by name

The [ENS family integration](ens/) maps workspaces to family names, supports resumable name
registration and renewal, and displays a family tree. The agent can resolve a name or nickname
into a proposed USDC transfer. An inline identity confirmation and wallet signature precede
payment; receipt checks and spent-link tracking prevent repeating the same send after reload.

## Architecture

aindrive connects the source folders. AINMEM provides the family workspace and relationship
agent, with persistent records for consented conversations. AIN-UI renders file and payment
surfaces supplied by aindrive.

```mermaid
flowchart TD
    OLD[Older family devices: photos, recordings, recipes] --> DRIVE[aindrive: connected folders]
    NEW[Devices the family uses today] --> DRIVE
    DRIVE <-->|MCP and HTTP with account permissions| APP[AINMEM server: workspace and relationship agent]
    FAMILY[Family members] --> UI[Workspace, chat and AIN-UI file surfaces]
    UI --> APP
    APP --> MODEL[Configured local or hosted model]
    APP --> MEMORY[Persistent OKF room memory]
    APP --> DB[(PostgreSQL: pages, members, permissions)]
    APP -->|Eligible pages and databases| BACKUP[Markdown and CSV backup in a linked drive]
    APP --> RULES[Treasury rules and human approvals]
    RULES --> WALLET[Agent wallet]
```

Each room has its own memory bundle. The app checks the caller's membership and registered
path ACLs before exposing that memory; the agent runtime accesses its room's files directly.

**Stack.** Next.js 16 (App Router) · Postgres via Drizzle · iron-session · any
OpenAI-compatible endpoint for the LLM · Playwright for e2e. Production runs as a container
behind nginx; see [`docs/deployment.md`](docs/deployment.md).

## Running it

Use Node.js 22 and pnpm (the [container](app/Dockerfile) pins pnpm 11.10.0), plus PostgreSQL 16.
Run from the repository root:

```bash
# Skip if the intended local database is already running on port 5434.
docker compose up -d postgres

cd app
pnpm install --frozen-lockfile
cp .env.example .env.local
# Edit .env.local before continuing:
# POSTGRES_URL: the intended local database
# SESSION_SECRET: a random value of at least 32 characters
# OKF_ROOT: a writable absolute directory, or remove it to use app/okf-fs

# CLI schema commands need POSTGRES_URL in the environment.
# Match this to .env.local; this value is for the local Compose database only.
export POSTGRES_URL=postgresql://notion_clone:notion_clone_dev@localhost:5434/notion_clone
pnpm db:push                   # inspect the proposed schema changes; apply to this DB only
pnpm db:check
cd ..
scripts/dev.sh                 # starts or reuses the dev server on http://localhost:3110
```

Use `scripts/dev.sh status` and `scripts/dev.sh logs` for diagnostics. The script isolates dev
build output in `.next-dev3110`. See [repository working rules](CLAUDE.md) before starting
another server or changing a shared database. `GET /api/health` returns 503 for missing schema
or an unavailable database; details are in the server log and `pnpm db:check`.

### Sign-in and optional services

Google OAuth is **optional**. The login screen also supports aindrive, an injected wallet,
an AIN key, and configured demo accounts.

| Feature | Configuration |
|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`; authorize `http://localhost:3110/api/auth/google/callback` |
| aindrive sign-in and files | `AINDRIVE_SERVER`; people connect their own accounts. See `AINDRIVE_*` in [the environment reference](app/.env.example) |
| Family demo login | `DEMO_LOGIN_ADDRESS` and the [demo setup](docs/demo.md); production additionally requires `ENABLE_DEMO_LOGIN=1` |
| LLM answering and memory extraction | `AI_URL`, `AI_MODEL`, optional `AI_API_KEY`, `AI_REASONING`; default endpoint is `http://localhost:8100/v1` |
| Treasurer tool calls | A model endpoint that supports tool calls; current GitHub main also supports separate `AI_TOOLS_URL`, `AI_TOOLS_MODEL`, `AI_TOOLS_API_KEY`, `AI_TOOLS_REASONING` |
| Public links | `APP_ORIGIN`, such as `http://localhost:3110` |
| Object storage | Optional `MINIO_*`; start MinIO with `docker compose -f docker-compose.local.yml up -d minio` when configured |
| World ID and Treasury | Separate credentials, chain configuration and funded wallets; follow [World setup](world/README.md#try-it) |

The `.env.example` comments are not exhaustive; integration setup lives in the linked guides.
Without a reachable LLM, the recording pipeline falls back to deterministic entries. Model-based
answers, image interpretation and the treasurer need a working endpoint. The send-guard allows
sending without a completed check when its model call fails. `AGENT_FAKE_LLM=1` explicitly selects
the agent's test behavior; `AI_FAKE_LLM=1` is used by supported AI test paths.

### Checks

From `app/`, with `POSTGRES_URL` exported for the intended database (standalone CLI scripts
do not automatically load Next.js `.env.local`):

```bash
pnpm typecheck
pnpm lint
pnpm db:check
pnpm check:prompt
pnpm exec playwright test
```

Playwright uses port 34100 by default (`E2E_PORT` overrides it), a disposable OKF fixture and
fake AI settings. Its database comes from `app/.env.local`: the default harness does **not**
create an isolated database. Use a dedicated test database for runs that create or change data.
Additional `e2e/*.check.mjs` scripts have their own setup requirements; they are not all run by
`playwright test`. Treasury, chain and fork checks are documented in [World](world/README.md)
and [Uniswap](uniswap/README.md).

### Current implementation limits

- Memory idle timers and the recording mutex live in one server process. A restart loses idle
  timers; the next message or manual run can process the backlog. Multiple replicas need
  durable job coordination before relying on the same behavior.
- Treasury rules use a supported grammar, not arbitrary natural-language policy execution.
  Editing a rules page does not adopt new rules by itself.
- The family demo needs its seeded accounts and reachable aindrive devices. A clean install
  does not contain the remote files or produce the seeded family automatically.
- World staging proofs, the local mock IdP, fork demos and live transactions are different
  modes. The integration guides record which paths were exercised and what credentials they need.

## Where things are

| Path | What |
|---|---|
| [`app/src/app`](app/src/app) | routes — pages, DMs, API |
| [`app/src/lib/agent`](app/src/lib/agent) | the recording pipeline, answering, the send-guard |
| [`app/src/lib/okf-store.ts`](app/src/lib/okf-store.ts) · [`okf-acl.ts`](app/src/lib/okf-acl.ts) | the memory files and who may read them |
| [`relational-memory-mcp`](relational-memory-mcp/) | the MCP server over the same bundles |
| [`world/`](world/) | the World submission — Relation Treasury, its demo script and integration debriefs |
| [`uniswap/`](uniswap/) | the Uniswap submission — the recurring buy, every Uniswap call with its line, FEEDBACK.md |
| [`app/src/lib/prompt-export`](app/src/lib/prompt-export/) | permission-aware page/database prompt export |
| [`app/src/components/ainui`](app/src/components/ainui/) · [`app/src/lib/ainui-boundary.ts`](app/src/lib/ainui-boundary.ts) | AIN-UI renderer integration and server action restrictions and folder chat |
| [`app/src/lib/aindrive-backup.ts`](app/src/lib/aindrive-backup.ts) | Markdown/CSV backups to connected folders |
| [`app/src/lib/files`](app/src/lib/files/) | uploads, resumable transfers and storage |
| [`contracts/`](contracts/) · [`sui/`](sui/) · [`ens/`](ens/) | chain contracts and optional integration scripts |
| [`archive/`](archive/) | earlier couple and sales demos |
| [`docs/deployment.md`](docs/deployment.md) | production deployment and operational notes |

## Changes during the Tokyo development window

**Sep 25, 21:00 → Sep 27, 09:00 JST.** Snapshot: **Sep 27, 08:53 JST** at
[`f1bde6c`](https://github.com/ainetwork-ai/relational-agents/commit/f1bde6c8b8a7640a5038bc410461f18a7c5da44f); later changes are not included. [All 361 commits](docs/changes-2026-09-25-to-27.md).

- **Family workspace, shared folders, invitations and agent scenarios.** [#5](https://github.com/ainetwork-ai/relational-agents/pull/5) · [#6](https://github.com/ainetwork-ai/relational-agents/pull/6)
- **Photo captions, subject-based albums and thumbnail loading.** [#32](https://github.com/ainetwork-ai/relational-agents/pull/32) · [`e80fe47`](https://github.com/ainetwork-ai/relational-agents/commit/e80fe475fde5bba071f7ee9365260d79a558a911)
- **aindrive share-sheet integration and paid shared files.** [#24](https://github.com/ainetwork-ai/relational-agents/pull/24) · [#26](https://github.com/ainetwork-ai/relational-agents/pull/26)
- **x402 providers, MetaMask checkout and paid-file previews.** [#8](https://github.com/ainetwork-ai/relational-agents/pull/8) · [#11](https://github.com/ainetwork-ai/relational-agents/pull/11) · [#22](https://github.com/ainetwork-ai/relational-agents/pull/22)
- **Wallet account selection before payment signing.** [`8c91120`](https://github.com/ainetwork-ai/relational-agents/commit/8c9112037f4f982eb33eff20406a3019961ecd21)
- **Permission-aware prompt export from pages and databases.** [#23](https://github.com/ainetwork-ai/relational-agents/pull/23)
- **English family demo and mobile layouts.** [#9](https://github.com/ainetwork-ai/relational-agents/pull/9) · [#10](https://github.com/ainetwork-ai/relational-agents/pull/10)
- **Treasury rules, human quorum and protected execution.** [`aa9fc39`](https://github.com/ainetwork-ai/relational-agents/commit/aa9fc3985d528b78d3b2f03ec50ba59a9db784ad) · [`86f7602`](https://github.com/ainetwork-ai/relational-agents/commit/86f760292a086940380aa352f0ad2e340597224f) · [`158ae8d`](https://github.com/ainetwork-ai/relational-agents/commit/158ae8d4d73e3fd90467e278075caa96852dc36c)
- **World ID v4 vote claims, fresh OIDC approvals and staging verification.** [`8955eb9`](https://github.com/ainetwork-ai/relational-agents/commit/8955eb9473bcc49c7be77ac578b82d0ae45c8c51) · [`4b771d2`](https://github.com/ainetwork-ai/relational-agents/commit/4b771d26e807cd100502110b3c040ac9c528142e) · [`0c81747`](https://github.com/ainetwork-ai/relational-agents/commit/0c81747efeef1131d2743c3739cf27dd5df8b50b)
- **Uniswap passbook, signed mandates, swap CLI and learning UI.** [#13](https://github.com/ainetwork-ai/relational-agents/pull/13) · [#15](https://github.com/ainetwork-ai/relational-agents/pull/15) · [#20](https://github.com/ainetwork-ai/relational-agents/pull/20)
- **Treasury investing and member-triggered weekly buys.** [`250a4aa`](https://github.com/ainetwork-ai/relational-agents/commit/250a4aa5f9c2c68096007a9fac9f4ac1f26512a9) · [#30](https://github.com/ainetwork-ai/relational-agents/pull/30)
- **Treasurer tool calls, wallet views and approval UX.** [#34](https://github.com/ainetwork-ai/relational-agents/pull/34) · [#38](https://github.com/ainetwork-ai/relational-agents/pull/38) · [`091985f`](https://github.com/ainetwork-ai/relational-agents/commit/091985fb346494a348e818fbe060ae44a59d69fe)
- **Separate model endpoint for tool calls.** [#39](https://github.com/ainetwork-ai/relational-agents/pull/39)
- **Public World demo, try-it rooms and local rehearsal.** [`ebd604e`](https://github.com/ainetwork-ai/relational-agents/commit/ebd604e26849eeee9b70a5bad2fc1268c5bb441e) · [`6e14363`](https://github.com/ainetwork-ai/relational-agents/commit/6e143634f0618586f3b246f06a9626ec43fad6aa) · [#37](https://github.com/ainetwork-ai/relational-agents/pull/37)
- **xyz deployment, automatic updates and macOS dev startup.** [#7](https://github.com/ainetwork-ai/relational-agents/pull/7) · [#16](https://github.com/ainetwork-ai/relational-agents/pull/16) · [#21](https://github.com/ainetwork-ai/relational-agents/pull/21)
- **World connection retries and Base RPC fallbacks.** [`061e202`](https://github.com/ainetwork-ai/relational-agents/commit/061e2022879b3ee26b16d991683a50b5745ce21f) · [`e8c5544`](https://github.com/ainetwork-ai/relational-agents/commit/e8c554483daedf551668c186bd967b400c5e0438) · [`e491d22`](https://github.com/ainetwork-ai/relational-agents/commit/e491d22f6c2552e8d2ccc08a4def6779fe0afde5)
- **World submission docs, debriefs and Uniswap feedback.** [`c55ed60`](https://github.com/ainetwork-ai/relational-agents/commit/c55ed60e795fa59dac898fe55701727f53f7aafa) · [`f915653`](https://github.com/ainetwork-ai/relational-agents/commit/f9156530851e52c6f9f092e600ec94069c873a7f) · [`ab40732`](https://github.com/ainetwork-ai/relational-agents/commit/ab40732825a4cabfd3c264a2aaf125c91f5bcdf6)

- **AIN-UI across file/account screens, folder chat and responsive galleries.** [`3dc36da`](https://github.com/ainetwork-ai/relational-agents/commit/3dc36dad753a6e1f98a70b2d7e2e79c03fe2a681) · [`96df3ee`](https://github.com/ainetwork-ai/relational-agents/commit/96df3ee350105c87a021b7640d6fb8dc3564f5dc) · [`f1bde6c`](https://github.com/ainetwork-ai/relational-agents/commit/f1bde6c8b8a7640a5038bc410461f18a7c5da44f)
- **ENS family registration, family tree and sending by name.** [`f0a13c8`](https://github.com/ainetwork-ai/relational-agents/commit/f0a13c8bbd0b8065dc056843d6a7dd1ea150685c) · [`ea0bf54`](https://github.com/ainetwork-ai/relational-agents/commit/ea0bf54aab8d317d97c71d3f177e9d8bc577a505) · [`71590cd`](https://github.com/ainetwork-ai/relational-agents/commit/71590cd4bb0ad318c81bc12e29c09a6696d9e2e7)
- **Uniswap Trading API routing and Permit2 member contributions.** [`b75ca73`](https://github.com/ainetwork-ai/relational-agents/commit/b75ca738678c99c1a029f6d40c898804d6f00ee4) · [`47c7a98`](https://github.com/ainetwork-ai/relational-agents/commit/47c7a98f7a7026e7726780d6813ac0a10bcdea70) · [`83691c7`](https://github.com/ainetwork-ai/relational-agents/commit/83691c797ad058620a37ca4464d3dbb92072215d)
- **Room folder mentions and deployment retry backoff.** [`3d90812`](https://github.com/ainetwork-ai/relational-agents/commit/3d90812311f0143b74093e60bb4e914ae977f41f) · [`93b49df`](https://github.com/ainetwork-ai/relational-agents/commit/93b49dfa10a04cdba2be2223fd99f81008356e30)

### Recent aindrive changes

Upstream snapshot: [`cd379f0`](https://github.com/ainetwork-ai/aindrive/commit/cd379f090f19b9ef96e345a9cf82162dd76f9940). These changes belong to the aindrive repository.

- **AIN-UI file/payment surfaces, responsive galleries and folder chat.** [`9d49672`](https://github.com/ainetwork-ai/aindrive/commit/9d496729bf82adfac753687887935f19b6376d89) · [`cd379f0`](https://github.com/ainetwork-ai/aindrive/commit/cd379f090f19b9ef96e345a9cf82162dd76f9940)
- **Mac 0.2.2, resident local Qwen model and semantic photo search.** [`1a06a96`](https://github.com/ainetwork-ai/aindrive/commit/1a06a96cd0c951afcc6aea5be61d2f6035cf854b) · [`4a31db7`](https://github.com/ainetwork-ai/aindrive/commit/4a31db72e1c079d6100d19cd1e0a7717d1c60cb0) · [`29e265d`](https://github.com/ainetwork-ai/aindrive/commit/29e265d7244bdfd3cfe462c64ca26bae15fecfed)
- **Android drive-scoped questions, live indexing and bounded RPC queues.** [`e469f6c`](https://github.com/ainetwork-ai/aindrive/commit/e469f6c5196b423519475058fac2bfe971af5159) · [`97547cd`](https://github.com/ainetwork-ai/aindrive/commit/97547cd85fdbfe6fe5dfba2e8c4468b6bbcdc874) · [`5d60f81`](https://github.com/ainetwork-ai/aindrive/commit/5d60f81e9bfc7828033050c72338087c1cea6e3a)
- **Phone storage picker and optional retention of downloaded models/indexes.** [`6452ba5`](https://github.com/ainetwork-ai/aindrive/commit/6452ba5cd3f5970825b9a8373525ded6ee571105) · [`fd308c0`](https://github.com/ainetwork-ai/aindrive/commit/fd308c00285d023a4b909bf982a9f910f3d01cb8)
- **Other devices can ask a drive's on-device agent through A2A.** [`20c812a`](https://github.com/ainetwork-ai/aindrive/commit/20c812a879eee0bd6a112f8a7b12cb659f9db7e3) · [`4d7c2b5`](https://github.com/ainetwork-ai/aindrive/commit/4d7c2b57199cda2bd73d15e5f60c55b289a97a79)
- **Recursive folder context, image/PDF access and streamed cloud handoff.** [`524e288`](https://github.com/ainetwork-ai/aindrive/commit/524e28810e92537f7307cd646ed636d1c04a598d) · [`1b32a65`](https://github.com/ainetwork-ai/aindrive/commit/1b32a65d5c154b880e0f3795217016e1a7b9b697) · [`6af7145`](https://github.com/ainetwork-ai/aindrive/commit/6af7145e56dd10c68fbb51b12d8be9609d0e2372)
- **Agent-then-folder mentions, Markdown replies and deduplicated answers.** [`19868c8`](https://github.com/ainetwork-ai/aindrive/commit/19868c803ea635533a4ced150e4cb9c1b6a69aec) · [`bbca5dd`](https://github.com/ainetwork-ai/aindrive/commit/bbca5ddb10651bdf50efc3b18d82dccf608f6ca1)
- **Local model assistance: phone opt-in, Mac enabled; rules remain the fallback.** [`203f2ba`](https://github.com/ainetwork-ai/aindrive/commit/203f2ba11b2ec30d75dca14c1c800eb4f83aed17)

## The relationship is the unit of memory

AINMEM continues the Relational Agent project: an agent belongs to a relationship and keeps
what its members choose to share. aindrive connects their sources, AINMEM preserves and organizes
the shared record, and AIN-UI gives those sources a common interface.

Today, the starting point is a family's drawer of old phones. The direction is any group that
wants lasting agent memory on devices it owns, with control over who can read it and what it
chooses to sell. A new phone should join that history, not become the reason it disappears.
