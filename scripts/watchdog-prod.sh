#!/bin/bash
# ainmem prod 워치독 — unhealthy 컨테이너를 재시작한다.
#
# 왜 있나: 2026-08-13, next-server(PID 1)는 살아 있는데 리슨 소켓만 사라져
# 3000이 닫힌 채 70분 동안 502가 났다(앱 로그·OOM·fd 어디에도 흔적 없음).
# docker 의 restart: unless-stopped 는 "프로세스 종료"에만 반응하고
# healthcheck 가 unhealthy 여도 아무것도 하지 않는다 — 그 틈을 이 스크립트가
# 메운다. cron 이 1분마다 부른다.
#
# 함정: /api/health 는 스키마 드리프트여도 실패한다(compose 주석 참고).
# 그 경우 재시작으로는 못 고치므로 무한 재시작 대신 10분에 한 번으로 막고,
# 로그를 남겨 사람이 보게 한다. 로그에 restart 줄이 반복되면 재시작으로
# 낫지 않는 문제라는 뜻이다.

set -u
NAME=ainmem_prod_app
STAMP=/tmp/ainmem-watchdog-last-restart
COOLDOWN=600 # 초

# 얼어 있는 것과 고장난 것은 다르다. `docker pause` 된 컨테이너는 헬스체크에 응답할 수
# 없어 unhealthy 로 보이는데, 워치독이 그걸 구분하지 못해 **2026-08-14 부터 15일 연속
# 매일 04:01 프로덕션을 재시작했다**(백업이 앱을 3분 10초 얼리는 동안). 재시작은 pause 를
# 깨우므로 백업이 지키려던 스냅샷 일관성까지 함께 무너졌다.
#
# 단, 얼어 있는 채로 **버려진** 것은 고장이다. 백업 스크립트의 trap 은 SIGKILL·OOM·호스트
# 재부팅을 못 잡으므로, pause 와 unpause 사이에서 죽으면 컨테이너는 영구 정지되고 이 가드는
# 영원히 손을 놓게 된다 — 예전 워치독이라면 90초 뒤 재시작으로라도 살아났을 상황이다.
# 그래서 처음 본 시각을 적어 두고, 정상 백업(수 초)이 절대 걸리지 않을 만큼 오래 얼어 있으면
# 재시작이 아니라 **unpause** 한다(안의 프로세스는 멀쩡하다).
PAUSED_STAMP=/tmp/ainmem-watchdog-paused-since
PAUSED_MAX=600 # 초 — 정상 백업은 정지가 몇 초다(docs/object-storage.md 7단계)
if [ "$(docker inspect -f '{{.State.Paused}}' "$NAME" 2>/dev/null)" = "true" ]; then
  now=$(date +%s)
  since=$(cat "$PAUSED_STAMP" 2>/dev/null || { echo "$now" > "$PAUSED_STAMP"; echo "$now"; })
  if [ $((now - since)) -ge $PAUSED_MAX ]; then
    echo "$(date -Is) paused 가 $((now - since))초 — 버려진 pause 다. docker unpause $NAME"
    docker unpause "$NAME"
    rm -f "$PAUSED_STAMP"
    exit 0
  fi
  echo "$(date -Is) paused — 백업 등으로 일시정지 중이다($((now - since))초). 재시작하지 않는다"
  exit 0
fi
rm -f "$PAUSED_STAMP"

status=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null) || exit 0
[ "$status" = "unhealthy" ] || exit 0

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -lt $COOLDOWN ]; then
  echo "$(date -Is) unhealthy 이지만 쿨다운 중 (마지막 재시작 $((now - last))초 전) — 재시작으로 낫지 않는 문제일 수 있다"
  exit 0
fi

echo "$now" > "$STAMP"
echo "$(date -Is) unhealthy → docker restart $NAME"
docker restart "$NAME"
