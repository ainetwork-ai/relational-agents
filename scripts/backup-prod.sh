#!/usr/bin/env bash
# ainmem prod backup — dumps the DB + file state as one set.
#
#   scripts/backup-prod.sh                 # with defaults
#   scripts/backup-prod.sh --no-pause      # without pausing the app (see §Consistency)
#   scripts/backup-prod.sh --keep 30
#   scripts/backup-prod.sh --out /mnt/backup
#   COPY_TO=user@host:/path scripts/backup-prod.sh   # plus an off-host copy
#
# The default destination is ~/ainmem-backups, **outside the repo**. Inside the repo a single `git add -A` could
# commit prod data — .gitignore reduces mistakes, but one `-f` or rule change
# defeats it. That is also why ainteams on the same host puts its db backups in ~/db-backups.
#
# What it backs up
#   db.dump       pg_dump -Fc (a single snapshot transaction, so the DB itself is consistent)
#   files.tar.gz  deploy/{okf-content,avatars} — the OKF tree is not derived; it is the
#                 content source (docs §3.2). Uploaded files are not here — they moved to MinIO and
#                 scripts/backup-objects.sh backs them up. **A restore needs both.**
#   MANIFEST      so that at restore time you know "which point in the code this data is from" —
#                 commit SHA, image tag, table/row counts, sha256, and the number of objects
#                 actually read back from the dump
#
# What it does not back up
#   md-mirror volume — the DB is the write model; the mirror is derived output rewritten on every change.
#   .env.prod     — putting secrets in the same archive as the data doubles the damage the moment
#                   one file leaks. Keep secrets on a separate path.
#
# Consistency
#   DB rows point at OKF paths and upload URLs, so if the two are from different moments references break.
#   That is why the order is fixed DB→files: files created in between are not in the dump, so
#   they are just harmless orphans. The other order would leave the DB pointing at missing files.
#   --pause (the default) removes even that gap — it freezes the app during the snapshot. The pause covers pg_dump + tar;
#   read-back verification only reads files already written, so it runs outside the pause.
#
#   ⚠️ Once files move to object storage this tar goes away — the pause shrinks to a few seconds
#   of pg_dump, and scripts/backup-objects.sh backs up the objects separately via the API (no app pause needed).
#   docs/object-storage.md step 7.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=ainmem_prod_app
PG=ainmem_prod_postgres
PAUSE=1
KEEP="${KEEP:-14}"
OUT="${OUT:-$HOME/ainmem-backups}"
COPY_TO="${COPY_TO:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pause) PAUSE=0; shift ;;
    --keep) KEEP="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
running "$PG" || { echo "$PG is not running — nothing to back up" >&2; exit 1; }

DB_USER=$(docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
DB_NAME=$(docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$OUT/$STAMP"
mkdir -p "$DEST"

# Whether it fails or is Ctrl-C'd, always bring the container back. Being left paused
# is worse than a failed backup.
unpause() { [ "$PAUSE" = 1 ] && running "$APP" && \
  [ "$(docker inspect -f '{{.State.Paused}}' "$APP")" = "true" ] && docker unpause "$APP" >/dev/null || true; }
trap unpause EXIT INT TERM

if [ "$PAUSE" = 1 ] && running "$APP"; then
  docker pause "$APP" >/dev/null
  echo "paused $APP"
fi

docker exec "$PG" pg_dump -U "$DB_USER" --no-owner --no-acl -Fc "$DB_NAME" > "$DEST/db.dump"
# `uploads` is gone — file bytes live in MinIO and scripts/backup-objects.sh backs them up
# separately via the API (no app pause needed). What is left here is only the OKF content tree and avatars, so
# this tar is now a few MB. That is why the pause went from 3+ minutes to a few seconds.
tar czf "$DEST/files.tar.gz" -C "$REPO/deploy" okf-content avatars

# Unpause here. The read-back verification below **only reads files already written**, so the app may run,
# yet we used to keep it frozen for those 40 seconds too. The shorter the pause the better — past 90s (healthcheck 30s×3)
# the watchdog mistakes it for a failure (watchdog-prod.sh guards against that mistake separately).
unpause

# Read-back verification. `pg_dump` exiting 0 means "writing did not fail", not "it can be
# read" — a full disk or broken pipe leaves a truncated file marked as success. Actually parse the TOC
# and count objects; 0 fails the backup (keeping an empty set in retention
# would make you think there is a rollback candidate).
OBJECTS=$(docker run --rm -i postgres:16-alpine pg_restore -l < "$DEST/db.dump" \
  | grep -cv '^;' || true)
if [ "${OBJECTS:-0}" -lt 1 ]; then
  echo "read-back verification failed: could not read objects from db.dump — discarding the set" >&2
  rm -rf "$DEST"
  exit 1
fi
tar tzf "$DEST/files.tar.gz" > /dev/null || { echo "files.tar.gz failed to read back" >&2; rm -rf "$DEST"; exit 1; }

trap - EXIT INT TERM

# Restoring a dump with a different schema version onto current code gets caught by /api/health (503),
# but it is better to start knowing they differ. So the commit and image tag are recorded too.
{
  echo "taken_at:   $(date -Is)"
  echo "host:       $(hostname)"
  echo "git_commit: $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "git_dirty:  $([ -n "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] && echo yes || echo no)"
  echo "app_image:  $(docker inspect "$APP" --format '{{.Config.Image}}' 2>/dev/null || echo '(not running)')"
  echo "paused:     $([ "$PAUSE" = 1 ] && echo yes || echo no)"
  echo "database:   $DB_NAME (role $DB_USER)"
  echo "tables:     $(docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "select count(*) from information_schema.tables where table_schema='public'")"
  echo "rows_approx: $(docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables")"
  echo "dump_objects: $OBJECTS (read back with pg_restore -l)"
  echo "sha256:"
  (cd "$DEST" && sha256sum db.dump files.tar.gz | sed 's/^/  /')
} > "$DEST/MANIFEST"

if [ -n "$COPY_TO" ]; then
  rsync -a "$DEST" "$COPY_TO/" && echo "copied to $COPY_TO/$STAMP"
fi

# Retention — delete the oldest sets first. Names sort by time, so sorting is chronological.
mapfile -t OLD < <(ls -1d "$OUT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP")
for d in "${OLD[@]:-}"; do [ -n "$d" ] && rm -rf "$d" && echo "pruned $(basename "$d")"; done

echo "backup: $DEST ($(du -sh "$DEST" | cut -f1))"
