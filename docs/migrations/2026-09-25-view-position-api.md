---
unit: view-position-api
date: 2026-09-25
commits: [97ef6c3]
scope:
  - app/src/app/api/databases/[databaseId]/views/[viewId]/route.ts
db-migration: none
depends-on: []
verify: PATCH 후 GET /api/databases/:id 의 views 순서 + 페이지 새로 열었을 때 랜딩 탭 확인
status: pending
---

# 뷰 PATCH의 position 지원 — 랜딩 탭 제어

## 무엇

`PATCH /api/databases/:databaseId/views/:viewId` body에 `position?: number`
허용. 뷰 목록은 position 오름차순으로 내려가고, 클라이언트는 `views[0]`을
기본 활성 뷰로 삼으므로 **position 최솟값 뷰 = 페이지를 새로 열었을 때의
랜딩 탭**이 된다.

## 왜

뷰 순서를 바꿀 API가 없어(POST는 항상 max+1) 나중에 만든 뷰(예: 대시보드)를
기본 화면으로 만들 방법이 없었다. API-only 확장이라 UI 변경 없음 — MCP·시드
스크립트가 소비자.

## 변경 상세

- body 검증 한 줄: `typeof body?.position === "number" && Number.isFinite(...)`
  일 때만 patch에 포함. `dbViews.position`은 doublePrecision이라 사이 값
  삽입(예: 최솟값-1, 두 뷰 사이 평균)이 그대로 동작.
- OKF(파일 기반) DB 경로의 `okfPatchView`는 position을 받지 않음 — 무시된다
  (구조적 타이핑이라 tsc 통과). 파일 DB 뷰 순서까지 필요하면 별도 작업.

## 검증

```bash
curl -X PATCH .../views/<viewId> -d '{"position": 0}' # 기존 최솟값보다 작게
# GET /api/databases/:id → views[0] 이 해당 뷰인지
# 브라우저에서 페이지 새로 열어 랜딩 탭 확인
```

## 함정

- 낮춰서 승격하는 방식이라 반복하면 음수로 내려간다 — 문제는 없지만
  (double), UI 재정렬 기능을 붙일 때는 정규화(1..n 재부여)를 고려.
