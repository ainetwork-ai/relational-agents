---
unit: chart-widget
date: 2026-09-25
commits: [07e6b6c]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-chart.check.mjs
db-migration: none
depends-on: []
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-chart.check.mjs
status: pending
---

# 차트 위젯 — 시계열 선/캔들 + 행 마커

## 무엇

새 위젯 kind `"chart"`. 아무 날짜 속성(x) × 아무 숫자 속성(y)으로:

- **선 모드**: 행을 시간순 점으로 이은 시계열.
- **캔들 모드**: 행을 시간 버킷(시간/일/주)으로 묶어 버킷 안 값들의
  시/고/저/종(OHLC)을 파생 — 가격 데이터가 아니어도 "버킷 안 분포 요약"으로
  동작. 상승 초록/하락 빨강.
- **마커(옵션)**: select/status 속성을 고르면 각 행이 옵션 색 점으로 찍히고
  범례가 붙는다 (예: buy/sell, 문의 유형).

SVG 직접 렌더, 차트 라이브러리 없음.

## 왜

대시보드에 시간 축 위젯이 없었다(bar/donut은 범주 집계뿐). 범용으로 설계해
어떤 DB든 날짜+숫자만 있으면 붙는다.

## 변경 상세

- `DashWidget`: `kind`에 `"chart"`, 필드 `xPropertyId` `yPropertyId`
  `chartType?: "line"|"candles"` `bucket?: "hour"|"day"|"week"`
  `markerPropertyId` 추가 (jsonb 안, DB 마이그레이션 없음).
- `dashboard-view.tsx`: `BUCKET_MS` 상수, `renderChart()`(지오메트리·그리드
  3줄·y 라벨 compact 포맷·시간 라벨은 범위<2일이면 HH:MM), KINDS/BODY/
  widgetTitle/addWidget 기본값(w2, line, 첫 날짜·숫자 속성) 반영. 편집 모드
  셀렉트: `db-dashw-charttype|x|y|bucket|marker-<id>` (bucket은 캔들일 때만).
- svg 요소 어트리뷰트: `data-chart-line` `data-chart-candle`
  `data-chart-marker` (+`<title>` 툴팁) — check가 이걸로 센다.
- i18n 키: `차트` `{name} 차트` `캔들` `시간별` `일별` `주별` `마커 없음`
  `{name} 마커` `날짜 속성과 숫자 속성이 필요합니다.`
  (**`선`은 en.ts에 이미 있음 — 중복 추가하면 TS1117**).

## 검증

check가 3일치 5행 임시 DB로: 선 path 1개+마커 5개 → 캔들(일별) 3개
(1일차 상승 초록·2일차 하락 빨강) → 마커 색 개수 → 마커 해제 0개 →
시간별 캔들 5개 → x/y 셀렉트 옵션 존재. 끝나면 삭제.

## 함정

- **캔들 x 도메인은 버킷 경계로 스냅해야 한다** (`floor(t0/b)*b` ~
  `(floor(t1/b)+1)*b`). 원시 체결 시각 범위로 잡으면 짧은 버스트 데이터에서
  버킷 중심이 캔버스 밖으로 나가 캔들이 안 보인다 — 실제로 겪은 버그.
- viewBox 폭은 위젯 너비에 비례(`PLOT_W` 맵 — [depth-widget](2026-09-25-depth-widget.md)
  커밋에서 도입). depth를 같이 옮기면 자동 해결, chart만 옮기면 W=560 고정도 동작은 함.
- y 라벨 왼쪽 여백 L은 62 필요(44면 "2,500.15"가 잘림).
