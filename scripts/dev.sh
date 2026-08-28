#!/usr/bin/env bash
# ainmem dev 서버 — 한 대만 띄우고, 모두 그 한 대를 쓴다.
#
#   scripts/dev.sh                 # 없으면 띄우고, 있으면 그걸 쓴다 (idempotent)
#   scripts/dev.sh status          # 누가 어디에 떠 있고 로그가 어디인지
#   scripts/dev.sh logs [-f]
#   scripts/dev.sh restart         # 이 레포의 서버일 때만
#   scripts/dev.sh stop
#
# 왜 스크립트인가
#   세션(사람이든 에이전트든)마다 `pnpm dev`를 띄우면 포트를 서로 뺏는다. 뺏긴 쪽은
#   조용히 죽고(ELIFECYCLE), 브라우저 탭은 죽은 서버를 계속 두드리며 "컴파일 중"에서
#   멈춘 것처럼 보인다. 실제로 그 일이 있었다. 그래서 start 는 **띄우기 전에 먼저
#   확인**하고, 떠 있으면 그대로 쓴다.
#
# 규칙 세 가지
#   1. 직접 `pnpm dev` 하지 말 것 — 포트도 빌드 디렉터리도 로그도 이 스크립트가 정한다.
#   2. 남의 서버를 죽이지 말 것 — stop/restart 는 프로세스의 cwd 가 이 레포일 때만 움직인다.
#   3. 접속은 http://localhost:3110 — 127.0.0.1 과 LAN 주소는 next.config.ts 의
#      allowedDevOrigins 에 있어야 dev 리소스(HMR)가 막히지 않는다.
#
# 로그와 pid 는 레포 밖(~/.ainmem-dev)에 둔다. 레포 안에 로그를 두면 파일 워처가
# 자기가 쓴 로그를 보고 다시 컴파일한다.
set -euo pipefail

PORT=3110
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app"
STATE="$HOME/.ainmem-dev"
LOG="$STATE/dev-$PORT.log"
PIDFILE="$STATE/dev-$PORT.pid"
DIST=".next-dev3110"

listener_pid() {
  # 이 포트를 실제로 물고 있는 프로세스 (없으면 빈 문자열)
  ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p" *$" {print}' |
    grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

proc_cwd()  { readlink "/proc/$1/cwd" 2>/dev/null || true; }
proc_log()  { readlink "/proc/$1/fd/1" 2>/dev/null || true; }
is_ours()   { [ "$(proc_cwd "$1")" = "$APP" ]; }

status() {
  local pid; pid="$(listener_pid)"
  if [ -z "$pid" ]; then
    echo "dev($PORT): 안 떠 있음"
    return 1
  fi
  # `next dev` 는 감시 프로세스와 서버 프로세스로 나뉜다 — 포트를 문 쪽이 서버다.
  echo "dev($PORT): 실행 중  pid=$pid  since=$(ps -o lstart= -p "$pid" | xargs)"
  echo "  cwd : $(proc_cwd "$pid")$(is_ours "$pid" || echo '   ← 이 레포가 아님!')"
  echo "  log : $(proc_log "$pid")"
  echo "  url : http://localhost:$PORT"
  return 0
}

# 재시작하면 거의 매번 밟는다: VS Code 원격 포워딩은 죽은 프로세스를 계속 가리키고,
# 브라우저는 에러도 없이 몇 분씩 스피너만 돈다. 서버는 멀쩡해 보이므로(요청이 아예
# 도착하지 않는다) 앱 문제로 오해하기 쉬워, 띄운 직후에 먼저 말해 준다.
forwarding_note() {
  cat <<TXT

  포트 포워딩을 쓰신다면 지금 갱신하세요 — 서버를 새로 띄웠으므로 옛 포워딩은 죽은
  프로세스를 가리킵니다 (브라우저는 에러 없이 무한 로딩이 됩니다).
    · VS Code 하단 PORTS 탭 → $PORT 삭제 후 다시 Forward (또는 Reload Window)
    · 터널 없이 확인:  http://$(hostname -I | awk '{print $1}'):$PORT
    · 판별법(서버에서):  ss -tn | grep :$PORT   → 0건이면 브라우저가 서버에 닿지 못한 것
TXT
}

start() {
  if status >/dev/null 2>&1; then
    echo "이미 떠 있어서 그대로 씁니다 (새로 띄우지 않음)"
    status
    return 0
  fi
  mkdir -p "$STATE"
  echo "dev($PORT) 시작 — 로그: $LOG"
  ( cd "$APP" && setsid nohup env NEXT_DIST_DIR="$DIST" pnpm dev >>"$LOG" 2>&1 </dev/null & echo $! >"$PIDFILE" )
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://localhost:$PORT/login" 2>/dev/null; then
      status
      forwarding_note
      return 0
    fi
    sleep 1
  done
  echo "60초 안에 응답이 없습니다. 로그를 보세요: $LOG" >&2
  tail -20 "$LOG" >&2 || true
  return 1
}

stop() {
  local pid; pid="$(listener_pid)"
  if [ -z "$pid" ]; then echo "dev($PORT): 안 떠 있음"; return 0; fi
  if ! is_ours "$pid"; then
    echo "dev($PORT) pid=$pid 는 이 레포($APP)의 서버가 아닙니다 — 건드리지 않습니다." >&2
    echo "  cwd: $(proc_cwd "$pid")" >&2
    return 1
  fi
  echo "dev($PORT) 종료 — pid=$pid (프로세스 그룹)"
  kill -TERM "-$(ps -o pgid= -p "$pid" | tr -d ' ')" 2>/dev/null || kill -TERM "$pid"
  for _ in $(seq 1 15); do
    [ -z "$(listener_pid)" ] && { rm -f "$PIDFILE"; echo "종료됨"; return 0; }
    sleep 1
  done
  echo "아직 살아 있습니다 (pid=$pid). 필요하면 kill -9." >&2
  return 1
}

logs() {
  local pid f; pid="$(listener_pid)"
  f="$LOG"
  # 다른 세션이 띄웠다면 그쪽 stdout 을 따라간다
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
