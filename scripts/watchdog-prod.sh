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
