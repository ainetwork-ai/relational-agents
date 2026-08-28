#!/usr/bin/env bash
#
# 오브젝트 스토리지 백업 — 오브젝트 단위 미러 + 판독 검증.
#
#   scripts/backup-objects.sh [목적지]
#
# **왜 tar 가 아니라 미러인가.** tar 는 (a) 라이브 데이터 디렉터리를 쓰기 중간에 잡을 수
# 있고 (b) 복원이 볼륨 통째 교체뿐이며 (c) 원본과 대조할 단위가 없다. `mc mirror` 는 API 를
# 거쳐 오브젝트 단위로 읽으므로 일관되고, 개수·총바이트를 원본과 맞춰볼 수 있다.
# 그리고 결정적으로 — **앱을 얼릴 필요가 없다.** 백업이 3분 10초 동안 앱을 정지시키던 것이
# 매일 04:01 워치독 재시작을 부른 원인이었다(docs/object-storage.md).
#
# **DB 는 여기서 안 뜬다.** Postgres 는 `s3://` 경로 **문자열**만 갖고 있어 바이트를 대신
# 지켜주지 않고, 반대로 오브젝트만 있으면 누가 무엇을 붙였는지 알 수 없다. 둘 다 떠야 하고
# 주기는 서로 달라도 된다 — 오브젝트는 내용 주소라 한 번 쓰인 키의 바이트가 절대 바뀌지
# 않으므로, DB 보다 드물게 떠도 안전하다.
#
# MinIO 는 포트를 노출하지 않으므로 호스트에서 직접 못 붙는다 — `minio/mc` 컨테이너를
# 같은 네트워크에 붙여 쓴다.
#
# 목적지 기본값은 **레포 밖** ~/ainmem-backups/objects 다. 레포 안에 두면 `git add -A` 한
# 번에 사용자 파일이 커밋될 수 있다(backup-prod.sh 와 같은 이유).
set -euo pipefail

OUT="${1:-$HOME/ainmem-backups/objects}"
KEEP="${KEEP:-4}"
NET="${MINIO_NETWORK:-ainmem_default}"
ENDPOINT="${MINIO_ENDPOINT:-minio:9000}"
BUCKET="${MINIO_BUCKET:-ainmem-files}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY 가 필요하다}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY 가 필요하다}"

STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$OUT/$STAMP"
mkdir -p "$DEST"

# --user 를 붙이는 이유: 안 붙이면 컨테이너가 root 로 써서 **사본이 root 소유**가 되고,
# 보존 정리(rm -rf)가 조용히 실패해 세트가 무한히 쌓인다. 실측으로 잡았다.
mc_cmd() {
  docker run --rm --network "$NET" --user "$(id -u):$(id -g)" \
    -e MC_HOST_src="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@${ENDPOINT}" \
    -e MC_CONFIG_DIR=/tmp/mc \
    -v "$DEST:/backup" --entrypoint mc minio/mc "$@"
}

echo "▸ mirror src/$BUCKET → $DEST"
mc_cmd mirror --quiet --overwrite "src/$BUCKET" "/backup/$BUCKET"

# 판독 검증 — 원본과 개수·총바이트를 맞춰본다. `mc mirror` 의 exit 0 은 "명령이 실패하지
# 않았다"이지 "다 왔다"가 아니다.
SRC_N=$(mc_cmd ls --recursive "src/$BUCKET" | wc -l)
DST_N=$(find "$DEST/$BUCKET" -type f 2>/dev/null | wc -l)
SRC_B=$(mc_cmd du "src/$BUCKET" | awk '{print $1}')
DST_B=$(du -sh "$DEST/$BUCKET" 2>/dev/null | cut -f1)
if [ "$SRC_N" -ne "$DST_N" ] || [ "$SRC_N" -eq 0 ]; then
  echo "판독 검증 실패: 원본 ${SRC_N}개 / 사본 ${DST_N}개 — 세트를 폐기한다" >&2
  rm -rf "$DEST"
  exit 1
fi

{
  echo "taken_at:   $(date -Is)"
  echo "host:       $(hostname)"
  echo "bucket:     $BUCKET @ $ENDPOINT"
  echo "objects:    $SRC_N (원본과 개수 일치 확인)"
  echo "size_src:   $SRC_B"
  echo "size_dst:   $DST_B"
  echo "note:       DB 는 별도다 — scripts/backup-prod.sh (db.dump). 둘 다 있어야 복원된다."
} > "$DEST/MANIFEST"

mapfile -t OLD < <(ls -1d "$OUT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP")
for d in "${OLD[@]:-}"; do [ -n "$d" ] && rm -rf "$d" && echo "pruned $(basename "$d")"; done

echo "objects: $DEST ($DST_B, ${SRC_N}개)"
