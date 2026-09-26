# Production deployment — ainmem prod (`ainmem_prod`)

> This document started as the decisions (and their reasons) made during the first
> live deployment on 2026-07-25 (memory.ainetwork.ai). On 2026-07-30, when this
> project was **brought over to the v100-02 host and stood up fresh as ainmem prod**,
> §1, §2, §4.3, §4.8, §5 and §6 were updated for this host, and on 08-03 domain/TLS
> (§3.7), Google sign-in (§3.8), wallet/demo removal (§3.9) and the General
> teamspace (§3.10) were added. The remaining decisions and pitfalls in §3 and §4
> hold regardless of host, so they are left as they were.
>
> **This is not a final version but a reference point for picking the work up.**
> It separates what is decided, what was discarded (and why), and what is still
> open. A new session should get the current state from §1 and continue from §6
> (open questions).

## 1. What is running now

Host `v100-02`, repo `/home/comcom/ainmem`. As of 2026-08-03.

| Item | Value |
|---|---|
| URL | `https://ainmem.ainetwork.ai` — live. Let's Encrypt (expires 2026-11-01, auto-renewed by `certbot.timer`), 80 → 301 (§3.7) |
| nginx | **Source of truth** `/etc/nginx/sites-available/ainmem.ainetwork.ai` · `deploy/nginx/…conf` is only a pre-install snapshot (§3.7) |
| App | Container `ainmem_prod_app` (`ainmem_prod:app-<sha>`) → `127.0.0.1:3100` |
| DB | Container `ainmem_prod_postgres`, DB/role `ainmem_prod` (port not exposed) |
| Content (OKF) | Host bind mount `deploy/okf-content/` (inside the project, gitignored) |
| Volumes | `ainmem_prod_pgdata`, `ainmem_prod_mdmirror` |
| compose | `docker-compose.prod.yml` (project name `ainmem_prod`) |
| Secrets | `.env.prod` (600, gitignored by the `.env*` rule) |
| LLM | **On hold** — only candidates, as comments in `.env.prod` (§4.8) |
| Sign-in | **Google only** (§3.8). Wallet and demo sign-in were removed (§3.9) |
| Data | Schema has 32 tables. 1 user, 2 workspaces — live use has begun |

The structure is `nginx (443, TLS termination) → 127.0.0.1:3100 → app container → postgres container`.

Names follow this host's conventions (`ainteams_prod_*`, `ainmem_dev_postgres`). At
first it was brought up with the `memory-live` identity (project, container, image,
DB, volume) that came with the imported repo, but **ainmem prod is a separate
service that shares nothing with that stack except the name**, so everything was
renamed. A single `docker ps` line should tell you which service and which
environment it is. At rename time the DB had 0 rows, so it was done with `down -v`
and a restart, no dump needed — once data accumulates, this cost is much higher.

### 1.1 ainmem.ainetwork.xyz — family demo (lab host, 2026-09-25)

While `v100-02` is unreachable, the demo runs on this lab host (`/mnt/newdata/git/relational-agents`).

| Item | Value |
|---|---|
| URL | `https://ainmem.ainetwork.xyz` — Cloudflare-proxied A record → this host's nginx (443, Let's Encrypt, certbot auto-renew) → `127.0.0.1:3150` |
| nginx | `/etc/nginx/sites-available/ainmem-xyz` (buffering off for SSE, 80 → 301) |
| compose | `docker-compose.xyz.yml` (project `ainmem_xyz`) · secrets `.env.xyz` (600, gitignored) |
| App / DB | `ainmem_xyz-app-1` (`ainmem_xyz-app:<sha>`) · `ainmem_xyz-postgres-1` (DB/role `ainmem_xyz`, `127.0.0.1:5439` only) |
| Content | `deploy-xyz/okf-content`, `deploy-xyz/uploads`, `deploy-xyz/avatars` (gitignored) |
| LLM | Host vLLM gemma `:8110` |
| Schema | On the empty DB, `POSTGRES_URL=…127.0.0.1:5439/ainmem_xyz npx drizzle-kit push` (once at first; later changes by hand as in §3.6) |
| Data | Family demo — `family-demo-accounts.mts --app http://127.0.0.1:3150 --home ~/.ainmem-demo-xyz --no-cli`, then `seed-family-demo.mts --home ~/.ainmem-demo-xyz` with `POSTGRES_URL`, `SESSION_SECRET` (values from .env.xyz) and `OKF_ROOT=deploy-xyz/okf-content`. The phone (aindrive drive) is the same one as dev — do not start a new CLI |

**Do not use** `docker-compose.prod.yml` (project `memory-live`) — another repo runs a stack with that same name on this host.

```bash
cd /mnt/newdata/git/relational-agents
# Build the image from a clean worktree of origin/main — the shared checkout has other sessions' uncommitted files mixed in
git fetch origin && TAG=$(git rev-parse --short origin/main)
git worktree add -f /tmp/ainmem-build-$TAG origin/main
# Through compose, not a bare `docker build`: the compose file passes the NEXT_PUBLIC_* build args
# (World ID app id) that are inlined into the browser bundle — a bare build ships them empty.
APP_TAG=$TAG docker compose --env-file .env.xyz -f /tmp/ainmem-build-$TAG/docker-compose.xyz.yml build app && git worktree remove --force /tmp/ainmem-build-$TAG
# Run from this directory (the volumes and .env.xyz live here)
APP_TAG=$TAG docker compose --env-file .env.xyz -f docker-compose.xyz.yml up -d
sed -i "s/^APP_TAG=.*/APP_TAG=$TAG/" .env.xyz
curl -s -o /dev/null -w '%{http_code}\n' https://ainmem.ainetwork.xyz/api/health
```

## 2. Deploy / rollback

```bash
cd /home/comcom/ainmem
E=.env.prod

# Deploy — tag the image with the commit SHA so the live version can be identified.
# Pass APP_TAG to build as well: compose's image is memory-live-app:${APP_TAG:-latest},
# so if .env.prod contains APP_TAG, build does not create :latest but overwrites
# that tag instead — one rollback point silently disappears.
TAG=$(git rev-parse --short HEAD)   # if it includes uncommitted changes, add a suffix (e.g. $TAG-ui)
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml build app
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml up -d app
sed -i "s/^APP_TAG=.*/APP_TAG=$TAG/" $E   # if the file drifts from live, the next person's
                                          # argument-less up rolls production back

# Rollback — go back to a previous tag (not just the source, node_modules too, exactly as of that point)
APP_TAG=<previous-SHA> docker compose --env-file $E -f docker-compose.prod.yml up -d app

docker images ainmem_prod   # list of candidates you can roll back to

# Do not deploy concurrently. If two sessions run `up -d app` at the same moment, one
# removes the container and the other then fails trying to create one with the same
# name — it ends in a name conflict and production is left with no container (502).
# Recovery:
#   docker ps -a --filter name=memory-live-app   # you'll see <hash>_memory-live-app-1
#   docker rm -f <that container>
#   APP_TAG=<tag> docker compose --env-file $E -f docker-compose.prod.yml up -d app

# Post-deploy verification — curl only proves the API responds. Whether the screens
# render must be checked with a real browser (read-only, does not touch live data).
# Always pass PROD_URL: its default is memory.ainetwork.ai (a different machine, §4.3).
cd app && PROD_URL=https://ainmem.ainetwork.ai \
  PROD_SESSION_SECRET="$(grep '^SESSION_SECRET=' ../.env.prod | cut -d= -f2-)" \
  PROD_USER_ID=8ccf17a7-24fb-4ae9-974c-94bf5db0cf85 \
  PROD_PAGE_ID=2ccdf2b6-66f6-4d58-9ea7-0c5fff97d2db \
  PROD_IMAGE_PAGE_ID=27b5c5e5-467c-4620-bde7-8d087e8a9875 \
  npx playwright test -c playwright.prod.config.ts
# Without the secrets, only what's visible anonymously runs (health, sign-in screen, file access denial).

# 503 if the schema is behind this build (what's missing: server log and pnpm db:check).
# Don't use -f: it discards the body on 400+, so you see nothing precisely
# "when there is a problem". Print the status code directly.
curl -s -o /dev/null -w '%{http_code}\n' https://ainmem.ainetwork.ai/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health   # check that bypasses nginx

# The container healthcheck looks at the same endpoint — unhealthy covers not just
# "the process died" but also "the schema is behind this build".
docker inspect -f '{{.State.Health.Status}}' ainmem_prod_app
```

`app/e2e-prod/prod-smoke.spec.ts` checks what a visitor sees — that the sign-in
screen appears, rooms and documents render, the content tree is not empty, and
uploaded assets load. It is all read-only. **Do not point the existing
`playwright.config.ts` at production** — it starts its own dev server, uses the
shared DB, and includes specs that actually modify data.

> On this host it **does not pass yet.** The rooms, documents and uploads the spec
> expects don't exist (the account does now), and sign-in has moved to Google, so the
> spec must be rewritten starting from its sign-in step (§6-8). Until then, deploy
> verification stops at `/api/health` 200 and a healthy container.

## 2.1 Backup / restore

```bash
scripts/backup-prod.sh                # default: briefly pause the app, keep 14 sets
scripts/backup-prod.sh --no-pause --keep 30
scripts/backup-prod.sh --out /mnt/backup
COPY_TO=user@host:/path scripts/backup-prod.sh   # also an off-host copy
```

Automatic run: **daily at 04:00, user crontab.** This is the first automated backup on
this host (ainteams on the same host only has manual dumps tied to its release
procedure, and its cron was empty). The log is appended to
`~/ainmem-backups/cron.log`, and **if there is no `backup:` line for the day, it
failed** — when the script fails read-back verification it deletes the set and exits 1.

```cron
0 4 * * * /home/comcom/ainmem/scripts/backup-prod.sh >> /home/comcom/ainmem-backups/cron.log 2>&1
```

Paths must be absolute — cron's cwd is `$HOME`. After registering, it was run once
with `env -i` in the same environment as cron to confirm.

**Also take one by hand right before deploying.** cron is the floor, and a deploy is
the moment you need a rollback point — if what accumulated since the last 04:00 is
lost in a deploy accident, it's lost even with cron. It's the same reason the ainteams
release procedure takes a pre-deploy dump (see §2).

One set lands in `~/ainmem-backups/<timestamp>/` as `db.dump` (pg_dump -Fc),
`files.tar.gz` (okf-content, uploads, avatars) and `MANIFEST`. md-mirror is excluded
because it is derived, and `.env.prod` is excluded so secrets don't go into the same
archive as data.

The destination is **outside the repo**. At first it lived inside the project like
`deploy/okf-content` (§3.5), but backups alone were moved out — `.gitignore` reduces
mistakes but is defeated by a single `git add -f` or rule change, and what gets
committed then is prod user data. ainteams made the same choice with `~/db-backups`
and `~/minio-backups`.

**The order is the safety mechanism.** DB rows point to OKF paths and upload URLs, so
if the two snapshots are taken at different moments the references break. The script
always goes **DB → files**: files created in between are not in the dump, so they are
merely harmless orphans; in the reverse order the DB would point to files that don't
exist. `--pause` (the default) removes even that gap. It has one side effect — while
paused, the healthcheck can't run, so the container briefly shows as `unhealthy`. It
recovers on its own at the next check (30s), but if anything ever reacts to health
status, it needs to know about this flicker.

**Read-back verification.** `pg_dump` exiting 0 means "the write didn't fail", not
"it can be read" — if the disk fills or the pipe breaks, a truncated file is left
looking like a success. So every run parses the TOC with `pg_restore -l` and counts
objects (currently 150), scans the archive with `tar tzf`, and deletes the set if
either fails. Keeping an unreadable backup in the retention list makes you believe
you have a rollback candidate. Same attitude as pitfall ⑥ of the ainteams release skill.

Restore like this (by hand, since it overwrites prod):

```bash
B=~/ainmem-backups/<timestamp>
docker compose --env-file .env.prod -f docker-compose.prod.yml stop app
docker exec -i ainmem_prod_postgres psql -U ainmem_prod -d postgres \
  -c 'drop database ainmem_prod' -c 'create database ainmem_prod'
docker exec -i ainmem_prod_postgres pg_restore -U ainmem_prod -d ainmem_prod \
  --no-owner --no-acl < $B/db.dump
tar xzf $B/files.tar.gz -C deploy
docker run --rm -v "$PWD/deploy:/d" alpine chown -R 1001:1001 /d/okf-content /d/uploads /d/avatars
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d app
```

If `git_commit` in `MANIFEST` differs from the current code, the schema may differ
too — if `/api/health` returns 503 after a restore, that's what's going on (§3.6).

On 2026-07-30 a full round trip through restore was verified with an empty DB:
restoring `db.dump` into a throwaway postgres container brought the tables back
intact, `files.tar.gz` contained the three directories, and the paused app was always
unpaused after the script exited (trap).

## 3. What was decided and why

### 3.1 Docker — adopted, replacing systemd + file copy

At first the repo had no Dockerfile, so it ran under systemd from an rsync copy.
**That was discarded.** It was a pile of files without git, so you couldn't pin what
was live to a commit, and rollback was impossible. Seeing that `aindrive` on the
first deploy host already ran by leaving images tagged with the commit SHA
(`predeploy-88e1755`), we followed that convention. A git worktree approach was also
considered, but it only rolls back the source, not `node_modules`, so image tagging
is better. On v100-02 we keep `ainmem_prod:app-<sha>` — this host's
`ainteams_prod:web` uses a fixed tag without a SHA, leaving no rollback candidates,
and that convention was not followed.

### 3.2 OKF content is a bind mount, not part of the image

`okf-store.ts` writes content at runtime with `writeFileSync`/`mkdirSync` — the
folder tree *is* the content DB. Baking it into the image means **documents
accumulated in live are wiped on every redeploy.** A host bind mount was used instead
of a named volume because documents created in live need to be openable directly and
recoverable via git. The container runs as uid 1001, so the mount path must be
`chown -R 1001:1001` for writes to work.

### 3.3 The production DB is a separate container with no exposed port

On this host, dev uses `ainmem_dev_postgres` (5434, DB/role `notion_clone`). Early on,
live pointed at the same DB, but a single `drizzle-kit push` in dev would change the
live schema on the spot, so they were split. The production DB **does not expose a
port** — this removes the very path by which a dev tool could reach it by mistake.
The DB and role names also differ (`ainmem_prod`), so connection strings can't get
mixed up (the values aren't baked into compose; they come from `POSTGRES_DB`/
`POSTGRES_USER` in `.env.prod`. If missing, the `:?required` guard stops before
startup).

For the first deployment, initial data was dumped from the dev DB with
`pg_dump --no-owner --no-acl` and loaded (`--no-owner` is mandatory because the role
names differ). On this host nothing has been loaded yet. When loading, **don't move
the DB alone** — if the OKF paths the rows point to aren't in `deploy/okf-content/`,
you're left with rows pointing at documents that don't exist. Copy the file tree too
for consistency.

### 3.4 Separate compose file

`docker-compose.prod.yml` is a separate file, and its project name is also different
(`ainmem_prod`). A `docker compose up` during development must never touch live. It
only comes up when you explicitly pass `-f docker-compose.prod.yml`.

### 3.5 All deployment state lives inside the project

`.env.prod` and the OKF content (`deploy/okf-content/`) are inside the repo. **Backups
alone are the exception and live outside** (`~/ainmem-backups`, §2.1) — other
deployment state, if committed by mistake, only leaks configuration, but backups are
all of prod's user data. At first, secrets were moved out under `/mnt/newdata/deploy/`
to keep them away from git, and **that was reverted.** `.gitignore` already has
`.env*`, so they can't get committed even inside the repo, while moving them out
scatters deployment state across the filesystem where the next person can't find it.
`/deploy/` was added to gitignore — it lives inside the project, but it is data, not
source.

As a result, compose paths are project-relative, like `./deploy/okf-content` and
`.env.prod`, not absolute. With just the repo, the deployment is reproducible.

### 3.6 The schema is not pushed automatically — instead, it tells you at startup

> **There are columns that don't exist in live right now.** The Projects port work on
> 2026-08-06 added `databases.item_name` and `databases.icon` (and before that,
> `description_visible`). They were added to dev by hand and are not in live yet.
> **Before shipping these commits to live, run `pnpm db:push` first** — drizzle
> SELECTs columns explicitly, so if a column is missing the whole database API returns
> 500. The healthcheck catches it as 503.

`drizzle-kit push` is run by hand, one DB at a time. Pushing automatically at boot
would give the deploy the power to drop columns, and nobody would read that diff
(the same story as why dev and live DBs were separated in 3.3).

Instead, read-only drift checks were placed in three places. All three call the same
function:

- **Boot log** — `src/instrumentation.ts`. If the schema matches it says nothing; if
  something is missing it prints the missing tables/columns and the command to apply
  them in one block. It does not block startup — one missing column is no reason the
  rest of the screens can't open.
- **`GET /api/health`** — 200 if it matches, **503** if something is missing. That's
  all: it doesn't put what's missing in the body. It's an unauthenticated endpoint,
  so including table/column lists or driver error strings
  (`connect ECONNREFUSED <host>:5432`, DB account names) would hand an internal map to
  anyone who asks. Details go to the server log and `pnpm db:check` — whoever is
  fixing it is already looking there.
- **`pnpm db:check`** — point it at any DB to check ahead of time. It exits 1 if
  something is missing, so it can be used as a gate.
- **Container healthcheck** — the app service in `docker-compose.prod.yml` looks at
  the same `/api/health` (via node's built-in fetch — the runner image has no curl).
  So unhealthy in `docker ps` covers not only "the process died" but also "the schema
  is behind this build".

Without this, the symptom looks like this: the deploy succeeds, and days later some
request dies with `column "call_id" does not exist`. Nobody knows which deploy it
started with.

The push runs as the `migrator` service — it has `profiles: ["migrate"]`, so it never
comes up with `up -d` and only runs via `--profile migrate run --rm migrator`. The
runtime image has neither drizzle-kit nor the schema source (standalone bundle), so it
uses the **builder stage**. Layers are shared with the app build, so there's no extra
cost.

### 3.7 The domain is `ainmem.ainetwork.ai`, TLS is managed by certbot

Applied 2026-08-03. `memory.ainetwork.ai` is a different machine (`101.202.37.14`) so
it wasn't used (§4.3); a new name was pointed at this host. DNS went in not as an A
record but as a **CNAME → `ainteams.ainetwork.ai` → `101.202.37.107`** — it works fine
(certbot HTTP-01 follows CNAMEs too), and if ainteams' IP changes it follows along.

Installation went: put in `deploy/nginx/ainmem.ainetwork.ai.conf` (an HTTP-only draft)
and run `certbot --nginx --redirect`. certbot writes the 443 block, certificate paths
and the 80 → 301 redirect directly into the live config. **From that moment on,
`/etc/nginx/sites-available/ainmem.ainetwork.ai` is the source of truth**, and the
draft in `deploy/nginx/` is only a pre-install snapshot. Copying it again strips
HTTPS — it's the same pitfall as the `setup-nginx.sh` incident recorded in
`~/NGINX-README.md`, so it's also noted in the draft's header.

Rationale for the conf values: `client_max_body_size 52M`. An upload request must pass
three gates, narrowing in this order — **tus chunk 8MB ≤ `proxyClientMaxBodySize` 50MB
≤ nginx `client_max_body_size`** (`app/src/lib/files/upload-protocol.ts` is the source
of truth). With the default 1M, photo uploads get cut off at nginx with a 413, and back
when it was 12M, 14–65MiB hwp/pdf/zip files attached to comments were cut off before
even reaching the app. Missing the middle gate is worse — Next 16 **truncates rather
than rejects** proxy bodies at a default of 10MB (measured by ainteams on 2026-08-06).
The total file limit is `MAX_UPLOAD_MB` (default 1024MB); `proxy_buffering off` (4 SSE
places — AI chat streaming, `dm/events`, `pages/[pageId]/events`. With buffering on,
tokens arrive in clumps or not at all until the response ends); `300s` timeout (covers
`/api/import`'s `maxDuration 300` and the 120s LLM call timeout); 5 proxy headers
including `X-Forwarded-Proto` (without it the app builds its own address as http and
redirects go wrong).

For the launch, `A2A_BASE_URL` in `.env.prod` was changed to
`https://ainmem.ainetwork.ai` (§4.10 — it's free while the DB is empty). Demo sign-in
was turned off with `0` right after launch, and shortly after **the sign-in path itself
was removed from the code** (§3.8).

The certificate expires `2026-11-01` and `certbot.timer` auto-renews it. In case
renewal fails silently, confirm once before expiry with `sudo certbot renew --dry-run`.

### 3.8 Google is the only sign-in

2026-08-03. There were three paths: demo sign-in (anyone as `DemoUser`), MetaMask
signature, and pasting an AIN private key. All were removed and **replaced with Google
sign-in only**.

The implementation is a hand-written server-side **authorization code flow**. No
library (Auth.js etc.) was added because this app already owns the session
(`iron-session`) — what's needed is two redirects and one token exchange, and a
framework takes over session management without giving anything more. As a bonus, we
choose the callback path ourselves (`/api/auth/google/callback`; with Auth.js it's
fixed at `/api/auth/callback/google`).

- `GET /api/auth/google/start` — puts state in the session and 302s to Google. The
  sign-in button is an `<a>` link, not a `fetch`, so signing in needs not a single
  line of client JS.
- `GET /api/auth/google/callback` — compare state (burned as single-use regardless of
  success or failure) → exchange code → look up/create account → issue session → home.

**The id_token signature is not verified.** It's a value our server fetched directly
over TLS from Google's token endpoint, authenticating with the client secret, so there
is no party in between to tamper with it (Google also documents this omission for the
code flow). Instead, everything that guarantee doesn't cover is checked: that `aud` is
our client, `iss` is Google, and `exp` hasn't passed. And if `email_verified` is false
it's rejected — using an unverified address as identity means that when the real owner
later signs in, they'd land in someone else's account.

Account matching is **`sub` first, email fallback**. Emails can change, so using only
email as the key turns the same person into strangers. Thanks to the fallback, rows
created by `page_invites` (email invites) are absorbed on first Google sign-in — while
`users` had no emails, those invites had no match at all.

Schema: `users` gained `google_sub` and `email` (both nullable UNIQUE), and
`ain_address` and `encrypted_private_key` went away (§3.9). Since the browser doesn't
call Google directly, the OAuth client **needs no JavaScript origins** — only a
redirect URI, and that value must not differ by a single character from
`GOOGLE_REDIRECT_URI`.

This is also why the dev port is fixed at **3110** (`next dev -p 3110`). You can't
register a redirect URI for an auto-assigned port. When developing on a remote host,
open a tunnel with `ssh -L 3110:localhost:3110 …` — Google allows http only for
`localhost` and compares the string as-is, so a LAN IP or `127.0.0.1` is a different
origin.

### 3.9 Wallet and demo were removed

2026-08-03. Everything that sat on top of the wallet once there was no one left to
sign (about 1,700 lines): the signing/verification library (`lib/wallet/*`), browser
provider hooks and buttons, consent/dissolve routes, EIP-712 type builders, the
`RelationalAgentRegistry` on-chain relay, and `/wallet-sign-demo`. The last one was
**a page that responded 200 on the public domain and asked visitors for a wallet
signature** — exactly the shape wallet extensions warn about, so there was no reason
to keep it.

Two dead ends in the UI went away too. The consent/dissolve banners in DMs showed
disabled buttons with the instruction "Sign in with a wallet to sign" — an instruction
nobody could follow. Leaving a room no longer requires a signature either.

Where behavior changed:

- **`chat_rooms.consent_at` is set when the room is created.** Previously it was
  `null` until everyone signed, and with wallets gone it would have stayed null
  forever. The column is kept — it's still read as the baseline "messages before this
  point are not collected into memory".
- **Agents don't receive keys.** Generated AIN keys sat in `encrypted_private_key` as
  plaintext hex, and the last reader was `dispatch.ts`, which used "has a key" to
  decide "an agent we created". Whether `a2aUrl` points at us states that fact directly.
- **External A2A bots no longer write an `a2a:<url>` marker into `ain_address`.**
  `a2a_url` and `a2a_id` already exist.

Demo fixtures were removed too: the `demo-cast`/`seed-demo-room`/`demo-ask` scripts,
the sunset seeder and its route, persona home covers, and the `demo:*` scripts in
`package.json`. `viem` and `@ainblockchain/ain-js` lost their last imports and were
dropped from dependencies along with their `serverExternalPackages` entries (lockfile
down 981 lines, 115 packages).

Removed from the DB: the `relation_contracts` and `relation_dissolves` tables (0 rows
in both DBs), `users.ain_address`, `users.encrypted_private_key`.

### 3.10 New workspaces start with a General teamspace

An empty Teamspaces section reads as broken, not as an invitation. There are two paths
that create a workspace (`ensureWorkspace` on first sign-in, and `POST /api/workspaces`
from the switcher), so both call a shared helper `ensureGeneralTeamspace()`. It's
idempotent by name, so even if called twice only one remains. The 2 workspaces created
before this rule existed were filled in with a single INSERT — code doesn't apply
retroactively.

### 3.11 aindrive integration — each person with their own aindrive account (2026-09-24)

The aindrive (https://aindrive.ainetwork.ai) integration runs **with each person's own
aindrive account**. Connecting uses aindrive's device approval (the same mechanism as
`aindrive login`). Clicking "Connect" in the app opens the aindrive approval window,
and if the browser is already signed in to aindrive, you just click approve. The
aindrive session received (30 days) is AES-GCM encrypted per person and stored in
`aindrive_accounts`. The key is derived from `SESSION_SECRET`. Changing that value
means everyone has to reconnect. After that, every aindrive call goes out via MCP
(`<AINDRIVE_SERVER>/mcp`) and runs as that person's own account.

**To do before shipping this feature to live**

1. Schema. It needs three new tables (`aindrive_accounts`, `aindrive_links`,
   `teamspace_drives`) and a new column `users.aindrive_sub` (unique, the account key
   for "Sign in with aindrive"). Push by hand as in §3.6.
   **Caution:** adding a unique column to a `users` table that has rows makes
   drizzle-kit ask "truncate the users table?". **Never truncate (No).** The new column
   is all NULL, so it doesn't violate unique. If this question stalls a non-interactive
   run, add it directly with SQL.
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS aindrive_sub text;
   ALTER TABLE users ADD CONSTRAINT users_aindrive_sub_unique UNIQUE (aindrive_sub);
   ```
   ```bash
   # if the compose file has a migrator service
   docker compose --env-file .env.prod -f docker-compose.prod.yml --profile migrate run --rm migrator
   # This repo's docker-compose.prod.yml has no migrator service (as of 2026-09-24).
   # If the host copy doesn't have one either, from app/ with POSTGRES_URL pointing at the production DB:
   #   pnpm db:check   # first confirm what's missing (exit 1 = something missing)
   #   pnpm db:push    # after reading the diff it shows
   ```
   These tables are add-only and don't touch existing columns. Still, read the diff
   push shows before moving on.
2. env (`.env.prod`):
   ```bash
   AINDRIVE_SERVER=https://aindrive.ainetwork.ai
   # AINDRIVE_CLIENT_NAME=ainmem   # name shown in the aindrive approval window (default ainmem)
   # Do not set AINDRIVE_TOKEN — with a shared server token, work without a personal
   #   account runs as that account. Connecting per person is the default.
   ```
   These are runtime values, not `NEXT_PUBLIC_*`. Restarting the container
   (`up -d app`) picks them up.
3. "Sign in with aindrive" on the sign-in screen goes all the way to signing in using
   the same approval mechanism. Accounts are looked up only by aindrive id
   (`users.aindrive_sub`). It does not take over an existing account with the same
   email because aindrive doesn't guarantee email verification. Once an existing user
   connects aindrive inside the app, both sign-in methods land in the same account.
4. After deploying, confirm `/api/health` 200. If the schema is behind, it's 503. Then
   in the app, check that the connect window appears from the sidebar's teamspace →
   "Sync to aindrive".

On the aindrive side: the change that makes the approval window show the app name
(ainetwork-ai/aindrive#99) and the delete tool `delete_path` (#97) must be deployed in
aindrive production for the wording and sync deletion to work properly. Connecting
and syncing work even before that (the window wording is the CLI one, and deleted page
files remain in the backup).

### 3.12 Family invites — `family_invites` (2026-09-25)

The link (`/family/<token>`) created by "Invite family" in the family folder sheet is
recorded as one row in `family_invites` (who invited whom (by name) to which
teamspace, and who accepted). The schema is pushed by hand — it's applied to dev, and
on the production DB run the following once before deploying (stop if drizzle-kit push
tries to touch users etc.):

```sql
CREATE TABLE IF NOT EXISTS family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  teamspace_id uuid NOT NULL REFERENCES teamspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES users(id),
  accepted_by uuid REFERENCES users(id),
  accepted_at timestamp,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_invites_teamspace_idx ON family_invites (teamspace_id);
```

## 4. Pitfalls — where the time went

### 4.1 The production build was broken from the start (resolved)

`next build` died on `/api/agent/[agentUserId]/spend` with `TypeError: Y is not a function`
(@noble/hashes sha3). The cause was Turbopack re-bundling code that AgentKit had
pre-bundled at publish time, breaking ESM interop; it was worked around by adding
`@coinbase/agentkit` to `serverExternalPackages`. When the World track (AgentKit
payment demo) was removed, that route and its dependency went with it, so this pitfall
no longer exists. Only `viem` and `@ainblockchain/ain-js` remain in
`serverExternalPackages`.

### 4.2 `| tail` hides a build failure as exit 0

`next build ... | tail -40` swallows the exit code. A build that actually failed was
reported as a success, and we went around in circles for a while. **Always use
`set -o pipefail` for build/gate verification.**

### 4.3 Public IP: egress ≠ ingress

`103.139.119.10`, which `curl ifconfig.me` returns, is the **egress** IP. What the DNS
A record must point to is **ingress**, and the two differ — this server is behind NAT.
Mixing them up makes certbot HTTP-01 fail.

Values confirmed on v100-02 on 2026-07-30:

| Name | Value | Notes |
|---|---|---|
| egress (`ifconfig.me`) | `103.139.119.10` | Same as the first deploy host — same NAT |
| `ainteams.ainetwork.ai` | `101.202.37.107` | Served by this host's nginx → this is **this host's ingress** |
| `memory.ainetwork.ai` | `101.202.37.14` | Same as `aindrive.ainetwork.ai` = **a different machine** |
| `ainmem.ainetwork.ai` | (no record) | |

So **`memory.ainetwork.ai` does not point at this stack.** That name remains on the
first deploy host (`.14`). To attach a domain to ainmem prod on this host, you either
point a new name at `101.202.37.107` or move the A record of `memory.ainetwork.ai`
(which kills the other side). In practice a new name was attached via CNAME — §3.7.

Because of the local resolver's negative cache, curling our own domain **from this
host** sometimes dies with 000, which is not an outage. In that case specify ingress
directly:

```bash
curl --resolve <domain>:443:101.202.37.107 https://<domain>/login
```

### 4.4 pnpm's 24-hour quarantine policy

pnpm 11 rejects packages published within the last 24 hours
(`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). This is a pnpm default, not a repo setting.
The lockfile is frozen and each entry has a sha512 integrity hash, so versions are
already pinned and verified; it was lifted only for image builds with
`--config.minimumReleaseAge=0`. Left on, every time a dependency is published the image
build is blocked for a day.

### 4.5 pnpm build-script approval blocks the image build

In `app/pnpm-workspace.yaml`, `allowBuilds:` still has 21 entries left as the
`set this to true or false` placeholder. Nobody has answered them, so a strict install
stops with `ERR_PNPM_IGNORED_BUILDS`. Dev has no compiled `.node` artifacts at all
either (everything runs on pure-JS fallbacks) — so skipping build scripts in the image
too is a choice that **matches** dev, not a deviation. `--config.strictDepBuilds=false`.

Next, `pnpm exec next build` also hits the same check again when it re-verifies
dependency state before running. The builder stage calls the binary directly with
`node_modules/.bin/next build`.

> The root fix is for someone to answer the 21 entries with `pnpm approve-builds` and
> commit the result. Until then, the two workarounds above are needed.

### 4.6 The dev server overwrites the prod build

As the `next.config.ts` comment says, running `next build` in the worktree lets a
concurrently running dev server overwrite the default `.next` and wipe the build. Moving
to Docker resolved this, but if you ever need to build directly on the host, isolate it
with `NEXT_DIST_DIR=.next-prodcheck`.

### 4.7 Every path the container writes to must be a volume

Runtime write paths baked into the image cause trouble twice. `COPY` puts them in owned
by root, so uid 1001 can't write (EACCES), and even if it could, they vanish entirely on
redeploy. `/api/upload` threw 500 because of this. Current volumes: OKF (`/data/okf`),
uploads/avatars (`/app/public/*`), md-mirror (`/data/md-mirror`).

Three fallbacks of the form `process.env.X ?? path.join(process.cwd(), ...)` remain
(`okf-store.ts`, `md-mirror.ts`, `workspace/export/route.ts`). If the env is missing,
they silently drift to a nonexistent path inside the container, and md-mirror swallows
the failure with `catch`. It's safe now because compose sets the env, but **the
untracked `docker-compose.yml` has no `MD_MIRROR_ROOT`** — deploying with that file
falls straight into this pitfall.

### 4.8 The container's `localhost` is not the host — and the endpoint differs per host

The `AI_URL` default `localhost:8100` points to the container itself inside the
container, so every LLM call died with `ECONNREFUSED`. It only showed up in logs and
silently fell through to a deterministic fallback, so on the surface everything looked
fine. The first deploy host had vLLM, so it was fixed with `host.docker.internal` +
`extra_hosts: host-gateway`.

**v100-02 has no vLLM (:8100).** Yet `AI_URL` was hardcoded in compose, so on this host
it pointed at nothing — a recurrence of the same pitfall. So it was taken out of compose.
`AI_URL`/`AI_MODEL`/`AI_API_KEY` are **runtime** variables, so they live only in
`.env.prod`, and changing them only needs a restart (no rebuild or new tag — the exact
opposite of `NEXT_PUBLIC_*` in §4.9). The `host.docker.internal` alias was kept.

It is currently **on hold**. Three candidates (ainetwork's shared
`llm.ainetwork.ai/v1`, Azure OpenAI, host-local) are written as comments in
`.env.prod`. For Azure, only the new v1 surface (`/openai/v1`) fits without code
changes — the old one uses an `?api-version=` query and an `api-key` header, so
`src/lib/ai/openai-compat.ts` would need changes.

What actually happens when it's unset (all confirmed):

| Path | Behavior |
|---|---|
| Memory writes `agent/pipeline.ts` | throw → catch → recorded as `fakeEdits`. Error logged |
| send-guard `agent/guard.ts` | throw → catch → sending allowed. Error logged |
| AI chat panel `ai-chat.ts` | **no catch → error on screen** |

Turning on `AI_FAKE_LLM=1` was an option, but it was not adopted. It flips the last
row — fake answers stream **as if they were real** and nothing is logged. If there's no
endpoint, it's better for that to show. The fake flag is for e2e/CI.

### 4.9 `NEXT_PUBLIC_*` is build-time, the server is runtime — setting only half is silent

compose was passing only some of the ARGs the Dockerfile declares. Missing values are
forever `undefined` in the browser bundle, but **the server reads the same names at
runtime.** So if you set a value only in `.env.prod` and restart, the server and the
browser believe different states, and that mismatch kills features **without a single
log line**. Now the Dockerfile's ARGs and compose's build args match 1:1. Changing a
value requires `build` + a new `APP_TAG`, not a restart.

### 4.10 A value, once stored, doesn't follow env changes

An agent's `a2a_url` and `agent_card_json.url` are frozen into the DB at provision time.
Even after changing `A2A_BASE_URL` to the production address, the existing 8 agents kept
advertising the dev LAN address (`http://192.168.1.193:36625/...`). In-app calls happened
to keep working thanks to the loose `url.includes("/api/a2a/")` match in `dispatch.ts`,
which made it even harder to see. It was corrected with a one-off UPDATE.

### 4.11 `req.url` is the container's bind address

Right after a successful Google sign-in, the browser went to
**`https://0.0.0.0:3000/`**. The wallet extension raised a phishing warning, and it was
right — legitimate sites don't send you to an address like that. The cause was the last
line of the callback:

```ts
NextResponse.redirect(new URL("/", req.url))   // req.url = http://0.0.0.0:3000/...
```

The container binds with `HOSTNAME=0.0.0.0 PORT=3000`, and the standalone server's
`req.url` holds that bind address, not the `Host` the proxy passed along. The sign-in
itself had already succeeded (account, session and workspace all created) — the fact
that only the last redirect was wrong is what makes debugging confusing.

The fix was **to use the origin of `GOOGLE_REDIRECT_URI` as the base**. Google verifies
that value character by character against the console registration, so by definition it
is this app's public origin, and there's no need to trust proxy headers
(`X-Forwarded-Host`). We also confirmed this is the only place in the app that builds an
absolute URL from the request.

### 4.12 The process lives but only the listen socket dies — nobody fixes unhealthy

At 2026-08-13 10:17:53Z, `ainmem_prod_app`'s next-server (PID 1) **stayed alive while
only its 3000 listen socket disappeared**. ~70 minutes of 502s followed. What it looked
like at diagnosis:

- Container `Up (unhealthy)`, 142 consecutive healthcheck failures — yet nothing
  happened. `restart: unless-stopped` reacts only to **process exit**, and docker takes
  no action on the unhealthy state.
- No 3000 LISTEN in `/proc/net/tcp` inside the container, `wget` from outside → refused.
  The nginx error log had 530 `recv() failed (104: Connection reset by peer)` — it's 104
  rather than 111 (refused) because docker-proxy accepts first.
- The root cause was **not found**: the app log had only 13 lines over the container's
  3-day lifetime (banner + Server Action spam), no OOM, fd 26/1048576, kernel log quiet.
  An unrelated container (multica) on the same host restarted 54 seconds earlier, but
  causality is unknown.

Action: recovered immediately with `docker restart ainmem_prod_app`, and to guard
against recurrence, `scripts/watchdog-prod.sh` was put on cron (every minute) — it
restarts when unhealthy, but since /api/health also fails on schema drift (§3.6), a
10-minute cooldown prevents infinite restarts, and it logs to
`~/ainmem-backups/watchdog.log`. **Repeated restarts in the log are a signal that the
problem isn't one a restart fixes.**

## 5. dev ↔ prod isolation status

| Resource | Status |
|---|---|
| Source / `node_modules` / build | **Separated** — built from a HEAD snapshot, clean install inside the image |
| Postgres | **Separated** — separate container (`ainmem_prod_postgres`) + separate volume + separate DB/role names |
| OKF content | **Separated** — bind mount (but not automatically recovered via git) |
| Ports | **Separated** — prod 3100, dev 3110 (fixed, §3.8) / dev DB 5434 |
| Port ranges | This host's convention: **ainteams 30xx, ainmem 31xx**. A single `ss -tlnp` line tells you which service |
| `SESSION_SECRET` | **Separated** — a live-only value |
| Google OAuth client | **Shared** — dev/prod redirect URIs registered on the same client. It only identifies accounts and doesn't touch data |
| LLM | **N/A** — this host has no vLLM and prod is on hold (§4.8) |

Ports, DBs and volumes also all differ from other services on the same host
(`ainteams_prod_*`, `ainteams_staging_*`). No resources overlap.

## 6. Open questions

1. **OKF recovery policy.** Documents written by live accumulate only in the bind mount
   and don't come back to git. We need to decide whether to commit them periodically or
   discard them.
2. **origin/main history rewrite.** Right after `18084c0` at 2026-07-25 01:35 UTC, a
   GitHub web UI upload commit was folded in via rebase, which re-stamped the SHAs of 179
   commits. Local main is a content superset of origin/main (+ 10 call-work commits), so
   a single `push --force-with-lease` would clean it up, but it's a history rewrite and
   needs agreement. It's cleanest to cut the deploy branch after that.
5. **Backups.** There are no backups yet for the production DB volume and the OKF bind
   mount. (Only manual snapshots in `deploy/backups/`.)
6. **ENS records point to the old A2A address.** The DB was corrected in §4.10, but the
   on-chain `agent-endpoint[a2a]` text record is still `192.168.1.193:36625`. It needs to
   be reissued for 8 agents, which costs gas and keys.
7. **Call STT is off.** `NEXT_PUBLIC_CALL_WEB_SPEECH` is unset, so browser speech
   recognition is always off and agents can't hear calls (recaps are 100%
   utterance-based). Dev is the same, so it's not a regression, but if a demo is going
   to show "the agent listens to the call", you need to pass `1` as a build arg and
   rebuild. If it stays off, `call-view.tsx` should be changed to always show the
   "STT unavailable" notice.
8. **Every human-backed payment is 403.** The World ID / humanbacked registry addresses
   are both unset, so `readIsHumanBacked()` always returns false and `seller.ts` rejects
   every payment. We need to decide whether to turn it on (build arg + runtime env
   together) or off (relax the `seller.ts` gate). This is also the same state as dev.
9. **Serializing deploys with `flock` — postponed until after the demo (agreed
   2026-07-26).** Both pitfalls in §2 are the kind people can't prevent through
   discipline. The concurrent `up -d` actually took production down for 40 seconds that
   day, and `APP_TAG` in `.env.prod` is a step separate from the deploy, so it keeps
   drifting (it was fixed by hand three times that day, and all three were overrun by
   the next deploy). A single script removes both:

   ```bash
   exec 9>/tmp/memory-live-deploy.lock
   flock -w 900 9 || exit 1                          # block concurrent deploys
   APP_TAG=$TAG compose build app && APP_TAG=$TAG compose up -d app
   sed -i "s/^APP_TAG=.*/APP_TAG=$TAG/" .env.prod    # make the pin part of the deploy
   ```

   Why not now: the lock only means something if every session uses this script, and
   during demo prep everyone types `docker compose` directly. A half lock only gives
   the illusion of "being protected". Add it once the demo is over and there's a single
   deployer.
