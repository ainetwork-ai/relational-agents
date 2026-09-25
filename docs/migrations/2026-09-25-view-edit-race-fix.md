---
unit: view-edit-race-fix
date: 2026-09-25
commits: [cfaa1ac]
scope:
  - app/src/components/database/database-block.tsx
db-migration: none
depends-on: []
verify: 아래 재현 절차 + dashboard-counter.check.mjs 반복 실행이 플레이크 없어야 함
status: pending
---

# SSE 스냅샷 재조회가 편집 중인 뷰 설정을 되돌리는 버그 수정

## 무엇

`refreshSnapshot()`이 실시간 이벤트마다 `setViews(snap.views)`로 서버 사본을
통째로 덮어서, 아직 PATCH가 서버에 착지하지 않은 뷰 설정 편집(필터·정렬·위젯
설정)이 조용히 롤백되던 버그의 수정.

## 왜

뷰 PATCH는 350ms debounce를 탄다. 그 창 안에(또는 서버 처리 전에) 다른
클라이언트의 행 추가 등으로 SSE가 오면 재조회가 낡은 config를 가져와 로컬
낙관적 상태를 덮는다. 사용자에겐 "방금 바꾼 설정이 저절로 풀리는" 증상.
**ainmem에 같은 refreshSnapshot 패턴이 있으면 같은 버그가 있다.**

## 변경 상세

- `dirtyViewConfigs` ref(`Map<viewId, ViewConfig>`) 신설.
- `patchViewConfig()`: 낙관적 `setViews` 직후 dirty 마킹; PATCH fetch의
  `.finally()`에서 **자기 config가 아직 최신일 때만** 삭제(늦게 착지한 옛
  PATCH가 새 편집의 보호를 풀면 안 됨).
- `saveDraft()`도 동일 마킹/해제.
- `refreshSnapshot()`: `snap.views`를 넣을 때 dirty한 뷰는 로컬 config 유지.

## 검증

재현(수정 전): 대시보드 편집 모드에서 위젯 설정을 0.5초 간격으로 연속 변경
+ 다른 세션(또는 API)으로 행 추가 → 앞선 변경이 풀림.
수정 후: `dashboard-counter.check.mjs`를 3회 연속 실행해 플레이크 없음 확인.

## 함정

- dirty 해제는 반드시 "최신 write 동일성" 비교(`get(vid) === config`)로.
  무조건 delete하면 레이스가 다시 열린다.
- `dirtyViewConfigs` 선언은 `refreshSnapshot`보다 위에 둘 것(클로저 참조).
