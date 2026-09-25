---
unit: depth-widget
date: 2026-09-25
commits: [00d7fc1]
scope:
  - app/src/lib/db/schema.ts
  - app/src/components/database/dashboard-view.tsx
  - app/src/i18n/en.ts
  - app/e2e/dashboard-depth.check.mjs
db-migration: none
depends-on: [chart-widget]
verify: BASE_URL=http://localhost:<port> node e2e/dashboard-depth.check.mjs
status: pending
---

# 깊이 위젯 — 두 사이드 누적 계단 영역

## 무엇

새 위젯 kind `"depth"`. select/status 속성의 **첫 두 옵션**으로 행을 갈라,
숫자 속성(레벨 축)을 따라 누적 계단 영역 두 개를 마주 보게 그린다 — 왼쪽은
자기 최고 레벨부터 바깥으로, 오른쪽은 최저 레벨부터 바깥으로(호가창 읽기).
크기는 다른 숫자 속성의 합 또는 행 개수. 같은 레벨의 여러 행은 합산된다.
본질은 "두 집단의 레벨별 누적 분포 비교"라 호가 데이터 전용이 아니다
(예: 연봉 축 × 지원자/공고).

## 왜

두 집단이 어떤 레벨에서 만나는지 보여주는 위젯이 없었다.

## 변경 상세

- `DashWidget.kind`에 `"depth"`. 새 필드 없음 — `xPropertyId`(레벨 축,
  chart 커밋에서 도입), `groupByPropertyId`(사이드), `aggregatePropertyId`
  (크기)를 재사용. jsonb 안이라 DB 마이그레이션 없음.
- `dashboard-view.tsx`: `renderDepth()`(레벨별 합산 → 사이드별 정렬·누적 →
  계단 path, 옵션 색 22% 채움+2px 윤곽, `<title>`=누적 합, 하단 범례에 총량),
  KINDS/BODY 반영. 편집 모드: 기존 groupBy·agg 셀렉트의 노출 조건에 depth
  추가 + 레벨 축 셀렉트(`db-dashw-x-<id>`, 숫자 속성 목록 — chart의 x는 날짜
  목록이므로 분기).
- `PLOT_W` 맵 도입: svg viewBox 폭을 위젯 너비(1~4)에 260/420/560/700으로 —
  w1에서도 축 글자가 읽히게. **chart 렌더러도 이걸 쓰도록 이 커밋에서 수정됨**
  (depends-on의 이유).
- svg 어트리뷰트: `data-depth-side="<optionId>"`.
- i18n 키: `깊이` `{name} 축` `숫자 속성과 옵션 2개 이상의 선택 속성이 필요합니다.`

## 검증

check가 bid/ask 사다리(같은 레벨 두 행 포함) 임시 DB로: 사이드 폴리곤 2개,
누적 합(레벨 합산 확인: bid 60/ask 70), 색(초록/빨강), 크기→개수 전환,
레벨 축 전환. 끝나면 삭제.

## 함정

- 사이드는 "옵션 중 첫 둘"이다 — 옵션이 3개 이상이어도 셋째부터는 무시.
- 색 검증은 stroke 어트리뷰트(#4ade80/#f87171) 직접 비교 — OPTION_HEX 팔레트
  상수가 ainmem에서 다르면 check 기대값을 맞출 것.
