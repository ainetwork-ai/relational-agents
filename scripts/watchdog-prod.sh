#!/bin/bash
# ainmem prod watchdog — restarts an unhealthy container.
#
# Why it exists: on 2026-08-13 next-server (PID 1) was alive but its listening socket vanished,
# so 3000 was closed and we served 502 for 70 minutes (no trace in app logs, OOM or fds).
# docker's restart: unless-stopped only reacts to "process exited" and does nothing
# when the healthcheck is unhealthy — this script fills that gap.
# cron calls it every minute.
#
# Trap: /api/health also fails on schema drift (see the compose comments).
# A restart can't fix that, so instead of restarting forever it is limited to once per 10 minutes,
# with a log line for a human to see. Repeated restart lines in the log mean the problem
# is not one a restart fixes.

set -u
NAME=ainmem_prod_app
STAMP=/tmp/ainmem-watchdog-last-restart
COOLDOWN=600 # seconds

# Frozen is not broken. A `docker pause`d container can't answer the healthcheck, so it
# looks unhealthy; the watchdog could not tell the difference and **from 2026-08-14 restarted
# production every day at 04:01 for 15 days straight** (while the backup froze the app for 3m10s). A restart
# wakes the pause, so the snapshot consistency the backup was protecting broke along with it.
#
# But a container **abandoned** while frozen is broken. The backup script's trap can't catch SIGKILL, OOM or a host
# reboot, so if it dies between pause and unpause the container stays paused forever and this guard
# would never let go — a situation the old watchdog would at least have recovered from by restarting after 90s.
# So it records when it first saw the pause, and if the container stays frozen far longer than a normal backup (a few seconds) ever could,
# it **unpauses** rather than restarts (the processes inside are fine).
PAUSED_STAMP=/tmp/ainmem-watchdog-paused-since
PAUSED_MAX=600 # seconds — a normal backup pauses for a few seconds (docs/object-storage.md step 7)
if [ "$(docker inspect -f '{{.State.Paused}}' "$NAME" 2>/dev/null)" = "true" ]; then
  now=$(date +%s)
  since=$(cat "$PAUSED_STAMP" 2>/dev/null || { echo "$now" > "$PAUSED_STAMP"; echo "$now"; })
  if [ $((now - since)) -ge $PAUSED_MAX ]; then
    echo "$(date -Is) paused for $((now - since))s — an abandoned pause. docker unpause $NAME"
    docker unpause "$NAME"
    rm -f "$PAUSED_STAMP"
    exit 0
  fi
  echo "$(date -Is) paused — suspended by a backup or similar ($((now - since))s). Not restarting"
  exit 0
fi
rm -f "$PAUSED_STAMP"

status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null) || exit 0
[ "$status" = "unhealthy" ] || exit 0

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -lt $COOLDOWN ]; then
  echo "$(date -Is) unhealthy but in cooldown (last restart $((now - last))s ago) — may be a problem a restart doesn't fix"
  exit 0
fi

echo "$now" > "$STAMP"
echo "$(date -Is) unhealthy → docker restart $NAME"
docker restart "$NAME"
