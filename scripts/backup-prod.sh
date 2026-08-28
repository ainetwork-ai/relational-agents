#!/usr/bin/env bash
# ainmem prod 백업 — DB + 파일 상태를 한 세트로 뜬다.
#
#   scripts/backup-prod.sh                 # 기본값으로
#   scripts/backup-prod.sh --no-pause      # 앱을 멈추지 않고 (§일관성 참고)
#   scripts/backup-prod.sh --keep 30
#   scripts/backup-prod.sh --out /mnt/backup
#   COPY_TO=user@host:/path scripts/backup-prod.sh   # 호스트 밖 사본까지
#
# 목적지 기본값은 **레포 밖** ~/ainmem-backups 다. 레포 안에 두면 `git add -A` 한 번에
# prod 데이터가 커밋될 수 있다 — .gitignore 는 실수를 줄이지만 `-f` 나 룰 변경 한 번에
# 무력화된다. 같은 호스트의 ainteams 도 db 백업을 ~/db-backups 로 빼는 이유가 이것이다.
#
# 무엇을 뜨는가
#   db.dump       pg_dump -Fc (단일 스냅샷 트랜잭션이라 DB 내부는 일관적)
#   files.tar.gz  deploy/{okf-content,uploads,avatars}
#                 — OKF 트리는 파생물이 아니라 콘텐츠 원본이다(docs §3.2).
#   MANIFEST      복원할 때 "이게 어느 코드 시점의 데이터인가"를 알기 위한 것 —
#                 커밋 SHA, 이미지 태그, 테이블·행 수, sha256, 그리고 덤프에서
#                 실제로 읽어낸 객체 수
#
# 무엇을 안 뜨는가
#   md-mirror 볼륨 — DB가 write model이고 미러는 변경마다 재출력되는 파생물이다.
#   .env.prod     — 데이터와 같은 아카이브에 시크릿을 넣으면 파일 하나가 새는
#                   순간 피해가 배가 된다. 시크릿은 별도 경로로 보관할 것.
#
# 일관성
#   DB 행이 OKF 경로와 업로드 URL을 가리키므로 둘의 시점이 어긋나면 참조가 깨진다.
#   순서를 DB→파일로 고정한 이유가 이것이다: 그 사이 생긴 파일은 덤프에 없으니
#   고아 파일로 남을 뿐 무해하다. 반대 순서면 DB가 없는 파일을 가리켜 깨진다.
#   --pause(기본)는 그 틈마저 없앤다 — 스냅샷 동안 앱을 얼린다. 정지는 pg_dump + tar 까지고,
#   판독 검증은 이미 쓰인 파일을 읽을 뿐이라 정지 밖에서 한다.
#
#   ⚠️ 파일이 오브젝트 스토리지로 옮겨가면 이 tar 자체가 없어진다 — 그때는 정지가 pg_dump
#   몇 초로 줄고, 오브젝트는 scripts/backup-objects.sh 가 API 로 따로 뜬다(앱 정지 불필요).
#   docs/object-storage.md 7단계.
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
running "$PG" || { echo "$PG 가 떠 있지 않다 — 백업할 것이 없다" >&2; exit 1; }

DB_USER=$(docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
DB_NAME=$(docker inspect "$PG" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_DB=//p')
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$OUT/$STAMP"
mkdir -p "$DEST"

# 실패하든 Ctrl-C 든 컨테이너는 반드시 다시 돌려놓는다. 멈춘 채로 남는 것이
# 백업 실패보다 나쁘다.
unpause() { [ "$PAUSE" = 1 ] && running "$APP" && \
  [ "$(docker inspect -f '{{.State.Paused}}' "$APP")" = "true" ] && docker unpause "$APP" >/dev/null || true; }
trap unpause EXIT INT TERM

if [ "$PAUSE" = 1 ] && running "$APP"; then
  docker pause "$APP" >/dev/null
  echo "paused $APP"
fi

docker exec "$PG" pg_dump -U "$DB_USER" --no-owner --no-acl -Fc "$DB_NAME" > "$DEST/db.dump"
tar czf "$DEST/files.tar.gz" -C "$REPO/deploy" okf-content uploads avatars

# 여기서 푼다. 아래 판독 검증은 **이미 다 쓰인 파일을 읽을 뿐**이라 앱이 돌아도 상관없는데,
# 그 40초까지 얼려 두고 있었다. 정지 시간이 짧을수록 좋다 — 90초(헬스체크 30s×3)를 넘기면
# 워치독이 고장으로 오해한다(그 오해 자체는 watchdog-prod.sh 가 따로 막는다).
unpause

# 판독 검증. `pg_dump` 의 exit 0 은 "쓰기가 실패하지 않았다" 이지 "읽을 수 있다" 가
# 아니다 — 디스크가 차거나 파이프가 끊기면 잘린 파일이 성공으로 남는다. TOC 를 실제로
# 파싱해 객체 수를 세고, 0 이면 백업 자체를 실패로 처리한다(빈 세트를 보존 대상으로
# 남기면 롤백 후보가 있다고 착각하게 된다).
OBJECTS=$(docker run --rm -i postgres:16-alpine pg_restore -l < "$DEST/db.dump" \
  | grep -cv '^;' || true)
if [ "${OBJECTS:-0}" -lt 1 ]; then
  echo "판독 검증 실패: db.dump 에서 객체를 읽지 못했다 — 세트를 폐기한다" >&2
  rm -rf "$DEST"
  exit 1
fi
tar tzf "$DEST/files.tar.gz" > /dev/null || { echo "files.tar.gz 판독 실패" >&2; rm -rf "$DEST"; exit 1; }

trap - EXIT INT TERM

# 스키마 버전이 다른 덤프를 지금 코드에 복원하면 /api/health 가 503 으로 잡아주지만,
# 어긋난 것을 알고 시작하는 편이 낫다. 그래서 커밋과 이미지 태그를 같이 적는다.
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
  echo "dump_objects: $OBJECTS (pg_restore -l 로 판독 확인)"
  echo "sha256:"
  (cd "$DEST" && sha256sum db.dump files.tar.gz | sed 's/^/  /')
} > "$DEST/MANIFEST"

if [ -n "$COPY_TO" ]; then
  rsync -a "$DEST" "$COPY_TO/" && echo "copied to $COPY_TO/$STAMP"
fi

# 보존 — 오래된 세트부터 지운다. 이름이 시각순이라 정렬이 곧 시간순이다.
mapfile -t OLD < <(ls -1d "$OUT"/[0-9]*_[0-9]* 2>/dev/null | sort | head -n -"$KEEP")
for d in "${OLD[@]:-}"; do [ -n "$d" ] && rm -rf "$d" && echo "pruned $(basename "$d")"; done

echo "backup: $DEST ($(du -sh "$DEST" | cut -f1))"
