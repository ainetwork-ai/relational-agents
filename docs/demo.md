---
title: Demo — The Kim Family, a family workspace built from three aindrive folders
icon: 🏡
---

# A family's scattered files meet in one space

**When Grandma, Mom, and Dad each connect their own aindrive folder — leaving the files right where
they are on their own computers — the family workspace fills itself in.**

Today is September 24, 2026, the first day of the Chuseok holiday. Tomorrow (the 25th) is Chuseok. The Kims are
gathering at Grandma's house. The recipes are in Grandma's folder, the grocery list and ancestral-rite table are in Mom's
folder, and the trip home and grave-visit plans are in Dad's folder. This demo shows those three folders becoming a
single family space.

## The cast and their aindrives

| Person | aindrive account | Drive (folder) | What's inside |
|---|---|---|---|
| 🧓 Grandma | Wallet account | "Grandma's Kitchen and Album" | Recipes for songpyeon, taro soup, mung bean pancakes, and sikhye; our family's ancestral-rite order; directions to the family burial hill; old photos and the stories behind them; Chuseok holiday medication reminders, medication schedule, blood pressure log, hospital appointments; letters to her grandchildren |
| 👩 Mom | Wallet account | "Mom's Household" | Three-day Chuseok schedule, chore assignment sheet (csv), ancestral-rite table menu and layout, grocery list (xlsx), gifts and pocket money (csv), full-moon wishes, family calendar, holiday photos |
| 👨 Dad | Wallet account | "Dad's Records" | Plans for the trip home and back, grave cleaning and visit plan, pre-trip car inspection (maintenance log), yut-nori bracket, post-Chuseok family meeting agenda (docx), Jeju trip plan, budget, and photos |
| 👴 Maternal Grandpa | Wallet account | "Maternal Grandpa's Phone" | `photos/garden/` cabbages, chili peppers, pumpkins, persimmons; `notes/` garden journal; `health/` blood pressure notes — outside the family space at first, he joins by invitation |
| 👧 Seoyeon | Wallet account | "Seoyeon's Phone" | `album/` Jeju photos and album intro (→ Our Family), `birthday-prep/` recording (m4a) + transcript of the planning meeting for Grandma's birthday (→ Grandma's Birthday Prep, secret), `special-video/` a video for Grandma (not shared — opens only as an x402 gift) |

Grandma, Mom, and Dad share their whole drives; Seoyeon shares **folder by folder**. The photos carry the time, location, and device they were taken with (EXIF).

Each person's own device (aindrive drive) is what uploads the files. The 12 Chuseok files and 33 scenario files (including photos, videos, and recordings)
were uploaded to those devices with the aindrive MCP `write_file`, under each person's own account permissions (`scripts/family-demo-push.mts`, which reads them back and compares after uploading).

The four people each use **their own aindrive account** (wallet login, no email). They all
come into ainmem with "Sign in with aindrive", and on the screen right after login, **"Which aindrive
folders do you want to share with your team?"**, they pick their drive and share it into the "Our Family" teamspace
(the drive list and the ownership check go through the aindrive MCP, with their own account permissions). A connected folder can be opened by everyone in the teamspace family. Reads and
writes go to aindrive through MCP **under the account of the person who connected the folder**.

All photos are freely licensed photos from Wikimedia Commons, with credits in each folder's
`CREDITS.md`. The documents were written from real information (the 2026 Chuseok dates, traditional recipes,
ancestral-rite table rules, routes home for the holiday). Health data such as medication info is sample data; there is no real personal information.

## Setup (once)

```bash
cd app
# 1) Four people: aindrive account (wallet) + drive (aindrive CLI) + ainmem account
pnpm tsx scripts/family-demo-accounts.mts --data ~/.ainmem-demo/source/family
# 2) Files onto each person's device — via the aindrive MCP, under each person's account (optional: skip if already there)
pnpm tsx scripts/family-demo-push.mts --from ~/.ainmem-demo/source/family
# 3) Family workspace "The Kim Family": 2 teamspaces (Our Family · Grandma's Birthday Prep [private]),
#    drive/folder connections, 13 pages, 2 chat rooms, x402 gift, pocket-money ledger
pnpm demo:family            # use --reset to rebuild
# (Optional) Make "today's trip photos" literally true: move the trip photos' capture date to today (fixes the phones' EXIF via MCP)
pnpm tsx scripts/family-demo-trip-date.mts --end today
```

- Drive folders, wallet keys, and CLI homes live in `~/.ainmem-demo/` (outside the repo; key files are mode 600).
- Three aindrive CLIs must be running on this machine for files to open. To bring them back up, just run
  step 1) again. CLIs that are already running are left alone.
- If `DEMO_LOGIN_ADDRESS` is set, "Start with the demo account" signs in as **Mom**.
  Below it, clicking **As another family member: Grandma · Dad · Seoyeon** signs in as that person directly (scenario 4 uses Grandma).
- The source files and generation tools (photo download, EXIF, recording synthesis, video) are in `~/.ainmem-demo/source/`.

## English demo (xyz)

The same family and the same Chuseok, in English — English names ("Grandma", "Mom", "Dad", "Seoyeon",
"Grandpa"), English drives ("Grandma's Kitchen & Album", "Mom's Household", "Dad's Records", "Seoyeon's Phone",
"Grandpa's Phone"), English folders and files, and an English workspace ("The Kim Family", teamspaces "Our Family"
and "Grandma's Birthday Plans"). It is a parallel data set, not a translation of the Korean one:
its own wallets, drives and ainmem accounts, in its own home, `~/.ainmem-demo-en/`.

**One switch picks the demo: `DEMO_CONTENT_LANG=ko|en`** (default `ko`), read only in
`app/src/i18n/content/demo-lang.ts`. The server reads it at runtime (the pocket-money ledger paths, the family
agent's names, the demo login's display name); the scripts take `--lang en`, which sets it and makes
`~/.ainmem-demo-en` the default `--home`. A home remembers its language in `family.json`, and the scripts refuse
to mix them. Dev (3110) stays Korean — do not put `DEMO_CONTENT_LANG` in `app/.env.local`.

| | Korean (dev) | English (xyz) |
|---|---|---|
| Content | `i18n/content/family-seed.ts`, `family-demo.ts`, `scripts.ts` | `family-seed.en.ts`, `family-demo.en.ts` |
| Source tree | `~/.ainmem-demo/source/family` | `~/.ainmem-demo-en/source/family` |
| Generators | `~/.ainmem-demo/source/tools/gen.py`, `media.py` | `~/.ainmem-demo-en/source/tools/gen_en.py`, `media_en.py` |
| Drive folders | `~/.ainmem-demo/drives/<person>` | `~/.ainmem-demo-en/drives/<person>` |
| Ledgers | `LEDGER` in `family-demo.ts` (Korean paths) | `wallet/pocket_money_ledger.csv`, `wallet/received_pocket_money.csv` |

The English tree has the same 90 files as the Korean one: text and office files from `gen_en.py`; photos copied
from the Korean tree under English names (EXIF kept, the Jeju trip EXIF written in place); the handwritten
recipe card, the batter video, the birthday-planning recording and its transcript, and Seoyeon's video and
preview from `media_en.py` (edge-tts en-US voices — needs the network).

```bash
cd /mnt/newdata/git/relational-agents/app
EN=~/.ainmem-demo-en

# 0) (only when the content changes) regenerate the English source tree — text/office first, then media
python3 $EN/source/tools/gen_en.py $EN/source/family
(cd $EN/source/tools && uv run --with edge-tts --with piexif --with pillow python media_en.py $EN/source/family)

# 1) The five people, on xyz: aindrive wallet accounts + drives + xyz ainmem accounts.
#    Copies the tree into $EN/drives/<person> and STARTS FIVE NEW aindrive CLIs serving those folders
#    (they are new drives, not dev's — unlike the Korean xyz data in deployment.md §1.1, no --no-cli).
#    Run it again to bring the CLIs back up; running ones are left alone.
pnpm tsx scripts/family-demo-accounts.mts --lang en --home $EN --data $EN/source/family --app http://127.0.0.1:3150

# 2) xyz serves the English demo. In ../.env.xyz set
#      DEMO_CONTENT_LANG=en
#      DEMO_LOGIN_ADDRESS=<English Mom's wallet>     # jq -r .members.mom.wallet ~/.ainmem-demo-en/family.json
#    and recreate the container (env_file is read on up -d)
(cd .. && APP_TAG=$(grep ^APP_TAG= .env.xyz | cut -d= -f2) docker compose --env-file .env.xyz -f docker-compose.xyz.yml up -d)

# 3) Seed against xyz's DB — POSTGRES_URL / SESSION_SECRET from .env.xyz, OKF_ROOT = xyz's content.
#    DEMO_LOGIN_ADDRESS must be the English Mom's (step 2): app/.env.local's dev value would otherwise win.
set -a; . ../.env.xyz; set +a
export POSTGRES_URL="postgresql://ainmem_xyz:$POSTGRES_PASSWORD@127.0.0.1:5439/ainmem_xyz"
export OKF_ROOT="$PWD/../deploy-xyz/okf-content"
pnpm tsx --tsconfig scripts/tsconfig.json scripts/family-demo-push.mts --lang en --home $EN --from $EN/source/family  # optional: push over MCP, read back
pnpm demo:family --lang en --home $EN                                                  # "The Kim Family"; --reset rebuilds it
pnpm tsx --tsconfig scripts/tsconfig.json scripts/family-demo-trip-date.mts --lang en --home $EN --end today  # optional: the trip ends today

curl -s -o /dev/null -w '%{http_code}\n' https://ainmem.ainetwork.xyz/api/health
```

- push and trip-date import `src/lib` (which imports `server-only`), so they need `--tsconfig scripts/tsconfig.json`
  (it stubs `server-only`) — `pnpm demo:family` already passes it.
- `--reset` finds the workspace by its English name, so it only ever removes the English "The Kim Family"; the Korean
  workspace seeded into the same DB earlier stays, but the demo login no longer lands there.
- Grandpa (Mom's father) joins by invite as in the Korean demo:
  `pnpm tsx scripts/family-demo-approve.mts --lang en --as grandpa --invite <link> --app http://127.0.0.1:3150`.
- The chat sentences for the four scenarios, in English: "@agent make a shopping list for mung bean pancakes for 4",
  "@agent pull the to-dos out of the recording", "@agent make an album of the Jeju photos",
  "@agent give Seoyeon her pocket money and let's watch the video".

## Demo run (about 3 minutes)

### 0:00 · Login — "Sign in with aindrive"
On the login screen, click **Sign in with aindrive**. In the aindrive approval window ("Connect “ainmem” to
aindrive"), click Authorize once and you are signed in as Mom. The sidebar's **AINDRIVE** immediately shows Mom's
account's drives. Mom's folder is already shared into "Our Family", so the sharing screen is
skipped — if there is a drive not yet shared, it appears on that screen already checked (you can reopen it anytime with
**Share with team** in the sidebar's AINDRIVE).
> "No sign-up, no uploads. Come in with the aindrive account you already use and your folders follow you."

### 0:30 · A teamspace where three folders meet
Under the **Our Family** teamspace in the sidebar there are three aindrive folders: "Mom's Household"
(synced), "Grandma's Kitchen and Album" (Grandma), and "Dad's Records" (Dad). Open Grandma's folder and you see
the recipes and old photos on Grandma's computer. Click an old photo and a preview opens right away.
> "Everyone's files stay on their own computers. All we did was connect them, and now the whole family can see them."

### 1:00 · 🎑 2026 Our Family Chuseok — preparation
Start from the hub page **2026 Our Family Chuseok**.
- **Chuseok schedule · trip home**: Mom's three-day schedule + Dad's plan for the trip home and back (leave at 7, Manghyang rest stop) + the pre-trip car inspection record.
- **Chore assignments**: Mom's chore sheet as a board (To do → In progress → Done). Move a status and everyone sees it.
- **Ancestral-rite table and food**: Mom's menu and layout, **our family's ancestral-rite order** as dictated by Grandma, Grandma's 4 recipes (songpyeon, taro soup, mung bean pancakes, sikhye), the grocery spreadsheet.
- **Grave cleaning · visit**: Dad's plan + Grandma's directions to the family burial hill ("the red ribbon", "pick up chestnuts on the way back").

Files from all three people's folders are mixed across the pages, yet there is not a single copy. They are all aindrive links.
Press **+** on an empty line and the top of the menu is **Import from aindrive**. Besides your own drive,
you can pick files from Grandma's and Dad's folders too, under "Folders shared to the teamspace".

### 1:40 · Things to look after, and memories
- **Grandma's health · holiday medication**: on Chuseok morning, Seoyeon handles the medicine at 7, before the rite. Medication schedule table, blood pressure log, hospital appointments.
- **Gifts · pocket money**: who gives what to whom, how much, and preparation status.
- **Chuseok album**: Grandma's photos from the 1950s–70s and their "photo stories", Mom's holiday photos.
- **Chuseok night · family meeting**: Dad's yut-nori bracket, Mom's full-moon wishes (did last year's wish come true?), the post-Chuseok family meeting agenda.

### 2:20 · The agent in the family chat — answering from shared folders
The **Our Family** chat room. The agent reads the folders the family shared into the teamspace (with the sharer's permissions),
and says **which file** each answer came from. Questions we actually verified:
- `@agent On Chuseok, what time is Grandma's morning medicine and who's handling it?` → 7 a.m., Seoyeon (Grandma's `health/chuseok_holiday_medication.md`)
- `@agent What time does Uncle's family arrive? Who's picking them up?` → 9/24 18:41 at Nonsan Station, Dad (Dad's `trip-home/trip_home_plan.md`)
- `@agent What should we bring for the grave visit?` → rice wine, cups, dried pollack, fruit, a mat, work gloves, bug repellent… (Dad's `grave_cleaning_and_visit_plan.md`)
- `@agent What's Grandma's secret for taro soup?` → perilla seed powder at the end (Grandma's `recipes/taro_soup.md`)
- `@agent Order songpyeon` → the agent orders a box of songpyeon from **Moonlight Rice Cake Shop** with its own wallet.

### 2:50 · Wrap-up — backups go to OKF, in the original folder
Open "Mom's Household" and the pages you just saw are synced as OKF (Markdown +
CSV) into the `ainmem-our-family-…/` folder. Edit one and it syncs again a few seconds later.
> "The family's memories stay in the family's folders."

## After Chuseok — four scenarios

> Current state on 3110: the result pages for ①②③ (🛒 Mung Bean Pancakes for 4 — Shopping List · ✅ Grandma's Birthday Prep Meeting — To-dos · 📸 Jeju Trip Album)
> have each been created once as Mom, and the ④ gift is locked. To show everything from scratch, run `pnpm demo:family --reset`.
> Asking for the same thing again recreates the result page in the same place.

On any page, click the **round agent button at the bottom right** and the agent opens on the right.
At the top you see the aindrives this agent reads — Mom's, Grandma's, Dad's, and Seoyeon's album (signed in as Mom,
also "Seoyeon's Phone · Birthday Prep" in the secret teamspace). The agent reads each folder **under the account of the person who shared it**.
Asking with `@agent` in the family chat does the same thing.

### ① Cooking — Grandma's mung bean pancakes (🥞 Grandma's Mung Bean Pancakes)
The recipe, handwritten-note photo, batter-consistency video, and measuring guide from Grandma's phone, plus Mom's review from her phone, on one page.
> "Make a shopping list for mung bean pancakes for 4" → 🛒 **Mung Bean Pancakes for 4 — Shopping List**: Grandma's recipe scaled down to 4 servings,
> "a handful" converted with the measuring guide, as a checklist + summary + Grandma's materials.

### ② Birthday — "You know it's Grandma's birthday, right? What should we get her?" (🎂 Grandma's Birthday Prep · private)
The 10/11 planning-meeting recording on Seoyeon's phone (1 min 42 s, Mom, Dad, Seoyeon, Doyun) is shared only into a private teamspace that **leaves Grandma out**.
In the **Grandma's Birthday Prep** chat room (no Grandma):
> "You know it's Grandma's birthday, right? What should we get her?" → from the recording: a magnifying glass on a cord (Seoyeon), a lap blanket (Doyun)…
> "Pull the to-dos out of the recording" → ✅ **Grandma's Birthday Prep Meeting — To-dos**: a board by owner (Mom, Dad, Seoyeon, Doyun, Everyone), a due-date calendar, links to the recording and transcript.

If Grandma asks in the family room "What are the kids planning for my birthday?", the agent mentions only the family calendar everyone can see (cake, pocket-money envelope).
If she tries to open the recording directly, aindrive refuses (403). For Grandma, the private teamspace itself
does not appear in the sidebar, and the pages inside it do not open (404).

### ③ Family trip — photos from three phones become one album (✈️ Jeju Family Trip)
Agent button → "**Sort today's trip photos into an album.**"
→ 📸 **Jeju Trip Album**: 17 photos from Mom's (iPhone 15), Dad's (Galaxy S24), and Seoyeon's (Galaxy A35) phones,
grouped into days 1–4 by capture time and location (EXIF). Dad's photo that Mom received over KakaoTalk (the same file) appears only once, on the original's side.
"Today" means the trip that includes today, or the most recent trip if none does (to move it to demo day, use `family-demo-trip-date.mts`).

### ④ Pocket money while browsing a grandchild's album — special video via x402 (📷 Seoyeon's Album)
Under Seoyeon's album, **🎁 For Grandma, from Jeju** — a blurred preview and "🔒 Open with ₩50,000 pocket money" (x402 · 36.23 USDC → Seoyeon's wallet).
The original video exists only in an unshared folder on Seoyeon's phone. Sign in **as Grandma** and click the button, or in the family room say
"@agent Let's give Seoyeon some pocket money and watch the video" →
1. The gift URL responds with **402 Payment Required** + `PAYMENT-REQUIRED` (x402 v2, exact, Base Sepolia USDC, EIP-3009).
2. Grandma's family wallet signs `transferWithAuthorization` and retries with `PAYMENT-SIGNATURE`.
3. The signature is verified, and settlement goes to the **family pocket-money ledger** — one line each, with the same receipt, in Grandma's phone `wallet/pocket_money_ledger.csv` (300,000 → 250,000) and
   Seoyeon's phone `wallet/received_pocket_money.csv` (+50,000) (via MCP, under each person's account).
4. The video opens along with `PAYMENT-RESPONSE`, and the family room gets a notification: "🎁 Grandma gave Seoyeon ₩50,000 in pocket money…"

> There is no on-chain settlement in this environment — no wallet has a balance. Signing and verification are real EIP-3009,
> and a forged signature is rejected with 402 "signature does not match the payer".

**Where the money actually moves is a provider** (`src/lib/x402/`). The wire above never changes; the 402's
`extra.settlement` names the provider the payer must sign with, and the resource settles with the same one:

| Provider | Wallet | Settlement | When |
|---|---|---|---|
| `family-ledger` | a key this server keeps per person | two CSV rows in the family's aindrive over MCP | today's demo |
| `aindrive` | the person's aindrive agent wallet (`x402_wallet`) | aindrive's facilitator (`x402_sign` / `x402_settle` over its MCP) | the moment aindrive lists those tools for the account |

`GIFT_SETTLEMENT=auto` (default) picks `aindrive` when its x402 tools are there for the recipient's account, else the ledger;
`ledger` / `aindrive` force one. The aindrive side is in `aindrive/web/lib/x402-pay-skills.ts`, switched on there with
`AINDRIVE_AGENT_WALLETS=1` (and the `wallet:pay` scope for account grants).

**How agents and other UIs join in**
- **AG-UI**: `POST /api/gift/<id>/pay` with `Accept: text/event-stream` streams the run as AG-UI events
  (`RUN_STARTED`, `STEP_STARTED` quote → sign → settle → unlock, `STATE_SNAPSHOT` with the 402 terms and the receipt, `RUN_FINISHED` / `RUN_ERROR`).
  The gift block on the page consumes this and narrates each step on the button.
- **A2UI**: `GET /api/gift/<id>/a2ui` returns the gift as an A2UI v0.9 surface (locked: preview + pay button; open: video + receipt);
  `POST` with the renderer's `{ action }` (`ainmem.gift.pay`) runs the payment and returns the next surface.
- **MCP**: `/api/mcp` offers `list_gifts`, `gift_surface`, `pay_gift` and `a2ui_action`; every result carries the surface in
  `_meta["ai.ainmem/a2ui"]` and as an `application/a2ui+json` resource, the same convention as aindrive's tools, so one renderer draws both.

## Family folders and invitations — Maternal Grandpa joins with one tap on his phone

Connecting aindrive is no longer a setting you hunt down person by person; you see it all in one place: **Family Folders**.

- **Where to open it**: the **👪 Family Folders 5/5** pill at the top of the teamspace page, the icon next to the teamspace in the sidebar,
  and **Family Folders · Invite** in the agent panel. All three open the same sheet.
- **The sheet**: one row per family member — the folders they shared, whether their phone is on (● On / ◐ Off — can't read right now),
  people who were invited but haven't joined yet (○ Invited · awaiting approval), and, set apart, **Back up this space → Mom's Household [Back up now]**.
- **Invitation**: enter a name (e.g., Maternal Grandpa) and click **Create invite link** → a QR code and link, plus "Copy message". The recipient opens the
  link on their phone and taps **Approve with aindrive** once → **What would you like to share?** (Photos & videos ☑ · Recipes & notes ☑ · Health records ☐) →
  **Share and get started** → done. They join under the name written on the invite (Maternal Grandpa).

**Demo (Maternal Grandpa = Mom's father, who keeps a vegetable garden in Suwon)** — Grandpa on Dad's side has passed away and is the one honored at the ancestral rite, so the one being invited is Maternal Grandpa.
1. Sign in as Mom, **Family Folders → Invite family → "Maternal Grandpa"** → a QR code appears.
2. Playing Maternal Grandpa's phone (if you don't have a phone): `pnpm tsx scripts/family-demo-approve.mts --as grandpa --invite <link>`
   — exactly what the phone does: aindrive approval → join → share photos and notes (not health).
3. Maternal Grandpa appears on the sheet as **● Connected · Photos · Notes**. Ask the agent "Make an album from Maternal Grandpa's photos"
   → 4 garden photos, by date.
4. (Optional) If a phone is off, the agent says so: "⚠️ Dad's phone is off, so I couldn't read the files on it."

`family-demo-accounts.mts` creates Maternal Grandpa's account and phone but does not add them to the family workspace — he comes in by invitation.
`--reset` also resets the invitation and joining back to the start.

## Things to check
- Login → drive list in the sidebar's AINDRIVE (online ones first)
- 3 folders under the teamspace, each showing who connected it; only the backup folder says "Synced"
- File blocks on pages: previews for images, PDF, xlsx, pptx, docx, md, csv
- Files in folders connected by other family members open too (with the connector's permissions) — someone else's unshared drive does not open
- The agent answers from files in shared folders and names the source file (only folders in teamspaces everyone in the room can see)
- Signing in with aindrive shows a screen for choosing folders to share (skipped if everything is already shared)
- The first item in the `+` menu is Import from aindrive, and the import window has "Folders shared to the teamspace"

The earlier couple demo has moved to `archive/couple/`, and the salesperson demo to `archive/sales/`.
- Agent button at the bottom right → list of connected aindrives → "Sort today's trip photos into an album." → album page
- Seoyeon's video and recording are outside the shared folders, so aindrive refuses them (403); the video opens only via the gift payment
