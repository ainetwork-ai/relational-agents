#!/usr/bin/env bash
# ainmem dev server — start only one, and everyone uses that one.
#
#   scripts/dev.sh                 # start it if missing, reuse it if running (idempotent)
#   scripts/dev.sh status          # who is running where, and where the log is
#   scripts/dev.sh logs [-f]
#   scripts/dev.sh restart         # only when it is this repo's server
#   scripts/dev.sh stop
#
# Why a script
#   If every session (human or agent) runs `pnpm dev`, they steal the port from each other. The loser
#   dies silently (ELIFECYCLE), and the browser tab keeps hitting the dead server and looks stuck
#   at "compiling". That actually happened. So start **checks first, before
#   starting**, and reuses the server if one is up.
#
# Three rules
#   1. Do not run `pnpm dev` yourself — this script decides the port, build directory and log.
#   2. Do not kill other people's servers — stop/restart only act when the process's cwd is this repo.
#   3. Connect at http://localhost:3110 — 127.0.0.1 and LAN addresses must be in next.config.ts
#      allowedDevOrigins or dev resources (HMR) are blocked.
#
# Logs and the pid live outside the repo (~/.ainmem-dev). With the log inside the repo, the file
# watcher sees the log it wrote and recompiles.
set -euo pipefail

PORT=3110
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
STATE="$HOME/.ainmem-dev"
LOG="$STATE/dev-$PORT.log"
PIDFILE="$STATE/dev-$PORT.pid"
DIST=".next-dev3110"

listener_pid() {
  # the process actually holding this port (empty string if none)
  ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p" *$" {print}' |
    grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

proc_cwd()  { readlink "/proc/$1/cwd" 2>/dev/null || true; }
proc_log()  { readlink "/proc/$1/fd/1" 2>/dev/null || true; }
is_ours()   { [ "$(proc_cwd "$1")" = "$APP" ]; }

status() {
  local pid; pid="$(listener_pid)"
  if [ -z "$pid" ]; then
    echo "dev($PORT): not running"
    return 1
  fi
  # `next dev` splits into a watcher process and a server process — the one holding the port is the server.
  echo "dev($PORT): running  pid=$pid  since=$(ps -o lstart= -p "$pid" | xargs)"
  echo "  cwd : $(proc_cwd "$pid")$(is_ours "$pid" || echo '   ← not this repo!')"
  echo "  log : $(proc_log "$pid")"
  echo "  url : http://localhost:$PORT"
  return 0
}

# You hit this almost every restart: VS Code remote forwarding keeps pointing at the dead process,
# and the browser spins for minutes with no error. The server looks fine (requests never
# arrive), so it is easy to mistake for an app bug; say so right after starting.
forwarding_note() {
  cat <<TXT

  If you use port forwarding, refresh it now — the server was restarted, so the old forward points
  at a dead process (the browser will load forever without an error).
    · VS Code PORTS tab at the bottom → remove $PORT and Forward it again (or Reload Window)
    · check without the tunnel:  http://$(hostname -I | awk '{print $1}'):$PORT
    · how to tell (on the server):  ss -tn | grep :$PORT   → 0 lines means the browser never reached the server
TXT
}

start() {
  if status >/dev/null 2>&1; then
    echo "already running; reusing it (not starting a new one)"
    status
    return 0
  fi
  mkdir -p "$STATE"
  echo "dev($PORT) starting — log: $LOG"
  ( cd "$APP" && setsid nohup env NEXT_DIST_DIR="$DIST" pnpm dev >>"$LOG" 2>&1 </dev/null & echo $! >"$PIDFILE" )
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://localhost:$PORT/login" 2>/dev/null; then
      status
      forwarding_note
      return 0
    fi
    sleep 1
  done
  echo "no response within 60 seconds. See the log: $LOG" >&2
  tail -20 "$LOG" >&2 || true
  return 1
}

stop() {
  local pid; pid="$(listener_pid)"
  if [ -z "$pid" ]; then echo "dev($PORT): not running"; return 0; fi
  if ! is_ours "$pid"; then
    echo "dev($PORT) pid=$pid is not this repo's ($APP) server — leaving it alone." >&2
    echo "  cwd: $(proc_cwd "$pid")" >&2
    return 1
  fi
  echo "dev($PORT) stopping — pid=$pid (process group)"
  kill -TERM "-$(ps -o pgid= -p "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid"
  for _ in $(seq 1 15); do
    [ -z "$(listener_pid)" ] && { rm -f "$PIDFILE"; echo "stopped"; return 0; }
    sleep 1
  done
  echo "still alive (pid=$pid). Use kill -9 if needed." >&2
  return 1
}

logs() {
  local pid f; pid="$(listener_pid)"
  f="$LOG"
  # if another session started it, follow that one's stdout
  [ -n "$pid" ] && [ -n "$(proc_log "$pid")" ] && f="$(proc_log "$pid")"
  echo "# $f"
  if [ "${1:-}" = "-f" ]; then tail -f "$f"; else tail -n "${1:-50}" "$f"; fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop && start ;;
  status)  status ;;
  logs)    shift; logs "${1:-50}" ;;
  *)       sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
