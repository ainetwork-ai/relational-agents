# ainmem 마이그레이션 문서 — 인덱스와 포맷

이 리포(relational-agents)에서 노션 앱(`app/`)에 추가한 기능을 ainmem으로
옮길 때, **기능 단위 문서 1개 = 마이그레이션 작업 1개**로 쓴다. 옮기면 해당
문서의 frontmatter `status`를 `ported`로 바꾸고 ainmem 커밋 해시를 적는다.

## 문서 포맷 (모든 문서 공통)

```yaml
---
unit: <slug>                 # 문서 파일명과 동일
date: YYYY-MM-DD             # 이 리포에 들어간 날
commits: [<hash>, …]         # cherry-pick 대상 (aqua/ 헝크는 버릴 것)
scope: [<파일 경로>, …]      # app/ 쪽 변경 파일
db-migration: none | <설명>
depends-on: [<unit>, …]      # 먼저 옮겨야 하는 문서
verify: <명령 또는 파일>
status: pending | ported
ported-commit: <ainmem 해시>  # ported일 때만
---
```

본문 섹션: **무엇** / **왜** / **변경 상세** / **검증** / **함정**.

## 목록 (권장 순서)

| # | 문서 | 커밋 | 상태 |
|---|---|---|---|
| 1 | [counter-formatting](2026-09-25-counter-formatting.md) | `154d1d9` | pending |
| 2 | [view-edit-race-fix](2026-09-25-view-edit-race-fix.md) | `cfaa1ac` | pending |
| 3 | [chart-widget](2026-09-25-chart-widget.md) | `07e6b6c` | pending |
| 4 | [depth-widget](2026-09-25-depth-widget.md) | `00d7fc1` | pending |
| 5 | [view-position-api](2026-09-25-view-position-api.md) | `97ef6c3` | pending |
| 6 | [db-push-script](2026-09-25-db-push-script.md) | `57799d7` | pending(선택) |

공통 전제: 전부 범용 제품 기능이라 트레이딩 코드 없음. `aqua/`(1inch
파이프라인·시드·리뷰 에이전트)와 dev DB에 시드된 데이터는 옮기지 않는다.
