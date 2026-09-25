---
unit: counter-formatting
date: 2026-09-25
commits: [154d1d9]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-counter.check.mjs
db-migration: none
depends-on: []
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-counter.check.mjs
status: pending
---

# 카운터 위젯 숫자 포매팅

## 무엇

대시보드 카운터 위젯이 값을 포맷할 수 있다: 소수 자릿수(자동/0–4), 리터럴
접두·접미어("$", " ETH" 등 — 통화 enum 아님), ±부호색(양수 초록+선행 `+`,
음수 빨강, 부호는 접두어 앞: `-$120.50`). 천 단위 구분은 항상 적용.

## 왜

카운터가 `0.0005` 같은 값을 `0.0`으로 뭉개고, 단위·통화를 표현할 방법이
없었다. PnL류 지표는 부호가 곧 상태라 색이 필요하다.

## 변경 상세

- `DashWidget`에 `decimals?: number` `prefix?: string` `suffix?: string`
  `colorBySign?: boolean` 추가 — 위젯 설정은 `db_views.config`(jsonb) 안이라
  타입만 늘고 DB 마이그레이션 없음.
- `dashboard-view.tsx`: `formatCounter(value, w)` 헬퍼 + renderCounter에
  부호색 클래스. 편집 모드에 셀렉트/인풋 4개 추가
  (testid `db-dashw-decimals|prefix|suffix|sign-<id>`), prefix/suffix는
  onBlur 커밋.
- i18n 키: `소수 자동` `소수 {n}자리` `접두어` `접미어` `±부호색`.

## 검증

check가 임시 DB를 만들어 컨트롤 4개를 전부 누르고 표기·색을 확인 후 정리한다.
전제 API: demo-login, `POST /api/databases {shape:"minimal"}`,
properties/rows/views/fullpage.

## 함정

- Tailwind v4는 computed color가 `lab()`으로 나온다 — 색 검증은 rgb 정규식이
  아니라 lab a축 부호(초록 음수/빨강 양수)로 한다.
- 연속 편집 검증은 [view-edit-race-fix](2026-09-25-view-edit-race-fix.md)가
  없으면 플레이크한다 — 그 버그를 이 check가 발견했다.
