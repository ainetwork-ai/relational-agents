# ainmem — rules for when several sessions work together

Humans and agents touch this repo in several sessions **at the same time**. These rules come from that.
Every one of them has actually blown up once, so they read more like an incident log than a matter of taste.

## One dev server only — `scripts/dev.sh`

```bash
scripts/dev.sh            # starts one if none is running, otherwise reuses it
scripts/dev.sh status     # who is running where, and where the log is
scripts/dev.sh logs -f
scripts/dev.sh restart    # only acts when the server belongs to this repo
```

- **Do not run `pnpm dev` directly.** When every session starts its own, they steal each other's port,
  and the loser dies silently (`ELIFECYCLE`). The browser keeps hitting the dead server and looks
  stuck at "compiling".
- Port **3110**, build directory **`.next-dev3110`** (using the default `.next` overwrites another
  session's prod/e2e build), logs/pid outside the repo in `~/.ainmem-dev/`.
- **Connect via `http://localhost:3110`.** To Next, `127.0.0.1` and the LAN address are different
  origins; unless they are in `allowedDevOrigins` in `next.config.ts`, `/_next/*` is blocked and the
  page stays at "compiling" forever without hydrating.
- Do not kill other people's servers. `stop`/`restart` only act when the process's cwd is this repo.

### After a restart, suspect port forwarding first

The browser connects through VS Code remote port forwarding. When you start a new server, **the old
forward stays pointing at the dead process**, and the browser spins for minutes with no error. If the
tunnel is a SOCKS proxy, other sites such as Google hang too. This happens often.

- The server side looks fine (`/api/health` 200, zero load), so it is easy to mistake for an app bug.
- One-line check: on the server, `ss -tn | grep :3110`. **Zero results means the browser never reached
  the server**, so there is no cause to find in the app.
- Fix: re-forward 3110 in the PORTS tab at the bottom of VS Code (or Reload Window). To confirm via a
  bypass, use `http://192.168.1.194:3110`.

## Commit only the files you touched

No `git commit -a` / `git add -A`. The working tree contains **files other sessions are in the middle
of editing**. Once, that pulled someone else's unfinished change into a commit: only the caller of a
component got committed while the component itself stayed untracked, and HEAD was broken.
`git add <path>` one path at a time.

## Push schema by hand

`drizzle-kit push` is done one DB at a time, with a human deciding (docs/deployment.md §3.6). The boot
log, `/api/health` (503), and `pnpm db:check` tell you what is missing. The dev DB is
`localhost:5434`.

## Projects work is measured against the original — if you can't see it, stop

When making `ComCom > Projects` **identical** to Notion, "done" is not a judgment call but **zero
difference from values measured on the original**. So if you cannot attach to the original, the
outcome is not work but a **stop**.

```bash
cd app && node e2e/golden.check.mjs   # 0 = can measure / 1 = stop and ask a human
```

How to attach (Chrome on the Mac + `ssh -R`), the rules for not touching the original, and the list
of existing comparison scripts are in `docs/notion-golden-set.md`. Filling the gap with inference and
changing the UI while the light is red is the single biggest source of reverts in this repo.

## Notion captures live in `docs/*.html`

That is what we are copying. They are not committed (large, and internal company data). Which state
of which screen each one is: see `docs/notion-captures.md`.

## No Korean outside `app/src/i18n/`

English is the source language of everything in this repo: code, comments, docs, scripts, e2e. Korean is an
i18n option, and it lives only under `app/src/i18n/` — `ko.ts` (English key → Korean) for UI text reached
through `t()` / `getT()` / `makeT()`, and `content/*.ts` for data that is Korean by nature (demo names,
seeded file paths, keyword lists, Notion golden-set fixtures). A Korean literal anywhere else is a bug;
`grep -rnP '[\x{AC00}-\x{D7A3}]' . --exclude-dir=node_modules --exclude-dir=i18n --exclude='*.html'`
should return nothing, and `node app/scripts/i18n-keys.mjs` lists keys with no Korean yet.

