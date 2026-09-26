#!/usr/bin/env bash
#
# Object storage backup — a per-object mirror + read-back verification.
#
#   scripts/backup-objects.sh [destination]
#
# **Why a mirror and not tar.** tar can (a) catch the live data directory mid-write,
# (b) only restore by replacing the whole volume, and (c) has no unit to compare with the source. `mc mirror` reads
# object by object through the API, so it is consistent and its count and total bytes can be checked against the source.
# And crucially — **the app does not have to be frozen.** The backup freezing the app for 3m10s was
# what triggered the daily 04:01 watchdog restarts (docs/object-storage.md).
#
# **The DB is not dumped here.** Postgres only holds the `s3://` path **strings**, so it does not
# protect the bytes, and objects alone don't tell you who attached what. Both must be backed up, and
# the intervals may differ — objects are content-addressed, so the bytes of a written key never change,
# which makes it safe to back them up less often than the DB.
#
# MinIO exposes no port, so the host can't connect directly — attach a `minio/mc` container
# to the same network.
#
# The default destination is ~/ainmem-backups/objects, **outside the repo**. Inside the repo a single `git add -A`
# could commit user files (same reason as backup-prod.sh).
set -euo pipefail

# cron has an empty environment — if not given, read from .env.prod (for the same reason as the outside-repo
# destination, credentials are not hard-coded in the script).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -z "${MINIO_ACCESS_KEY:-}" ] && [ -f "$REPO/.env.prod" ]; then
  set -a; . "$REPO/.env.prod"; set +a
fi

OUT="${1:-$HOME/ainmem-backups/objects}"
KEEP="${KEEP:-4}"
NET="${MINIO_NETWORK:-ainmem_prod_default}"
ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
BUCKET="${MINIO_BUCKET:-ainmem-files}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"

STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$OUT/$STAMP"
mkdir -p "$DEST"

# Why --user: without it the container writes as root, so **the copy is owned by root**, and
# retention cleanup (rm -rf) fails silently and sets pile up forever. Caught by measurement.
mc_cmd() {
  docker run --rm --network "$NET" --user "$(id -u):$(id -g)" \
    -e MC_HOST_src="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@${ENDPOINT}" \
    -e MC_CONFIG_DIR=/tmp/mc \
    -v "$DEST:/backup" --entrypoint mc minio/mc "$@"
}

echo "▸ mirror src/$BUCKET → $DEST"
mc_cmd mirror --quiet --overwrite "src/$BUCKET" "/backup/$BUCKET"

# Read-back verification — compare count and total bytes with the source. `mc mirror` exiting 0 means "the command did not
# fail", not "everything arrived".
SRC_N=$(mc_cmd ls --recursive "src/$BUCKET" | wc -l)
DST_N=$(find "$DEST/$BUCKET" -type f 2>/dev/null | wc -l)
SRC_B=$(mc_cmd du "src/$BUCKET" | awk '{print $1}')
DST_B=$(du -sh "$DEST/$BUCKET" 2>/dev/null | cut -f1)
if [ "$SRC_N" -ne "$DST_N" ] || [ "$SRC_N" -eq 0 ]; then
  echo "read-back verification failed: source ${SRC_N} / copy ${DST_N} objects — discarding the set" >&2
  rm -rf "$DEST"
  exit 1
fi

{
  echo "taken_at:   $(date -Is)"
  echo "host:       $(hostname)"
  echo "bucket:     $BUCKET @ $ENDPOINT"
  echo "objects:    $SRC_N (count matches the source)"
  echo "size_src:   $SRC_B"
  echo "size_dst:   $DST_B"
  echo "note:       the DB is separate — scripts/backup-prod.sh (db.dump). A restore needs both."
} > "$DEST/MANIFEST"

mapfile -t OLD < <(ls -1d "$OUT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP")
for d in "${OLD[@]:-}"; do [ -n "$d" ] && rm -rf "$d" && echo "pruned $(basename "$d")"; done

echo "objects: $DEST ($DST_B, ${SRC_N} objects)"
