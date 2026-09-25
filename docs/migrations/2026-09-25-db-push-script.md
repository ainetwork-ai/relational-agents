---
unit: db-push-script
date: 2026-09-25
commits: [57799d7]
scope:
  - app/scripts/db-push.mts
db-migration: none
depends-on: []
verify: npx tsx scripts/db-push.mts (적용할 statement가 없으면 no-op 출력)
status: pending
---

# (선택) guarded 비대화형 drizzle 스키마 push

## 무엇

`drizzle-kit push`는 TTY 프롬프트(예: "truncate users?")에서 멈춰서 에이전트/
CI에서 못 쓴다. `drizzle-kit/api`의 `pushSchema`를 직접 불러 statement를
전부 출력하고, **DROP TABLE / DROP COLUMN이 포함되면 실행을 거부**하는
스크립트. 런타임 코드가 아니라 개발 도구 — 옮길지는 ainmem 워크플로 판단.

## 왜

팀원 PR로 스키마가 앞서갔는데 dev DB가 뒤처졌을 때, 사람 개입 없이 안전한
CREATE/ALTER만 밀 방법이 필요했다.

## 변경 상세

- `app/scripts/db-push.mts` 신규 23줄. `drizzle-kit/api`의
  `pushSchema(schema, drizzle(pg))` → `statementsToExecute`를 검사 후 apply().
- **app/scripts 안에 있어야 한다** — 밖(스크래치 등)에 두면 drizzle-kit/api
  모듈 해석이 실패했다.

## 함정

- unique constraint 이름이 drizzle 컨벤션(`<table>_<col>_unique`)과 다르면
  (예: pg 기본 `_key`) pushSchema가 재생성 프롬프트를 띄우려 한다 —
  기존 제약을 drizzle 이름으로 맞춰두면 조용해진다.
- 그래도 프롬프트가 뜨는 케이스(truncate 질문)는 이 API로도 발생 가능 —
  그때는 해당 DDL만 psql로 선적용 후 재실행.
