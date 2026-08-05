# 원본 `Projects` 명세 — 우리가 맞춰야 할 것

2026-08-06, 노션의 ComCom `Projects` 페이지(풀페이지 데이터베이스)를 그대로 옮기는 작업의 기준
문서다. 값은 **추정이 아니라** 그 페이지에서 받은 설정 그대로다: 사용자 브라우저에 CDP로 붙어
`POST /api/v3/loadPageChunk`(읽기 전용)를 호출해 `collection` 1건과 `collection_view` 8건을
받았고(`chunk.json`, 76KB), 아래는 그 내용을 풀어 쓴 것이다.

> 읽는 방법: 속성 id는 노션이 4글자 코드(`L[OY`)나 UUID로 들고 있다. 아래 표의 이름으로 매칭하면 된다.

## 속성 23개

| 이름 | 타입 | 설정 |
|---|---|---|
| Project name | `title` | |
| TL / Assignee / Evaluator / Sherpa | `person` | 여러 명 담긴다 |
| Start date / End date / Reg Date / Vulnerable Since / ` Sec.8 Deadline` | `date` | 이름 앞 공백까지 그대로 |
| Effort | `number` | |
| Status | `status` | 옵션 `Not started·In progress·Deprecated·Needs review·Hold·Done`, **그룹 `To-do·In progress·Complete`** |
| Team | `multi_select` | 옵션 33개 (`AINSpace`, `KKaebi`, `Ops`, `한양대` …) |
| Created time | `created_time` | |
| Evaluation | `select` | `Superb·Strongly Exceeds Expectation·Exceeds Expectations·Meets Expectations·Need Improvement·NA` |
| Territory | `select` | `Japan·China·USA·EU·Singapore·Korea·Philippines·Malaysia` +2 |
| Law Firm | `select` | `KNK·ANK` |
| Action | `select` | `Re-file·Defend·Sec8 Filing·Counsel Review·None` |
| Status 1 | `select` | `Urgent·In Progress·Safe·Monitor` |
| Bonus 지급 여부 / Notes / Class / Reg Number | `text` | |

23종 전부 우리 스키마에 있는 타입이다. **없는 것은 `status`의 옵션 그룹**뿐이다.

## 뷰 8개

| 이름 | 타입 | 그룹 | 정렬 | 필터 | 보이는 컬럼 |
|---|---|---|---|---|---|
| on-going projects | 표 | `person` TL, 수동 정렬, **빈 그룹 숨김** | End date ↑ | — | 13개 (TL 250 · Project name 565 · Assignee 469 · Status 136 · Start 113 · End 130 · Evaluation 121 · Team 179 · Sherpa 117 · Evaluator · Created time · Effort · Bonus) |
| My | 보드 | `status` 옵션별, 빈 그룹 숨김 | TL↑ Sherpa↑ Assignee↑ End↑ | Assignee **또는** TL **또는** Sherpa 가 나 | 카드에 Project name · Team · Evaluation · TL |
| done projects | 표 | — | End date ↓ | Status **is 옵션** `Done` | 13개, `Team` 이 첫 컬럼 (266) |
| superb projects | 표 | — | — | Evaluation is `Superb` | 13개, `Team` 첫 컬럼 (192) |
| All Projects | 표 | **`multi_select` Team**, 빈 그룹 숨김 | End date ↑ | — | 8개 (`Status` 첫 컬럼 136) |
| My Timeline | 타임라인 | — | End date ↑ | TL 가 나 (+ Assignee 조건 비어 있음) | 타임라인 `End date` 기준, **옆 표 켜짐**(Project name 340 · Status 141 · Evaluation 200), 확대 `quarter` |
| TL | 표 | `person` TL, 빈 그룹 숨김 | End date ↑ | — | 12개 (Project name 516 · TL 134 · Effort 100 · Assignee 562 …) ← `docs/target.html` 이 이 뷰다 |
| TL Chart | **차트** | 아래 참조 | — | Status **is 그룹** `In progress` | — |

컬럼 **순서와 폭은 뷰마다 다르다**(같은 DB인데 첫 컬럼이 TL·Team·Status로 갈린다). 즉 순서는
데이터베이스가 아니라 **뷰가** 들고 있다.

표 뷰가 공통으로 들고 있는 값: `table_frozen_column_index: -1`(기본=첫 컬럼 고정),
`table_subitem_toggle_column: "title"`(하위 항목 토글은 제목 셀 안), `table_wrap: false`,
`subitem_filter_scope: "parents_and_subitems"`.

### TL Chart 설정

```
type: column                      // 세로 막대
dataConfig: groups_reducer
  groupBy:     person TL, 수동 정렬, hideEmptyGroups: false
  aggregation: sum(Effort)
  stackOptions: title 기준으로 쌓기(오름차순)
chartFormat:
  height: medium, mainSort: manual
  caption: "[ in-progress 상태인 것만 표시됨 ]"  (표시 켜짐)
  axisShowDataLabels: true, axisHideEmptyGroups: false
filter: Status is 그룹 "In progress"
```

## 우리가 만들어야 하는 것

1. **뷰별 컬럼 순서** — 지금 순서는 DB 전역(`property.position`)이라 뷰마다 다르게 둘 수 없다
2. **`multi_select` 그룹** — `All Projects`가 Team으로 그룹한다. 값이 여러 개인 행은 각 그룹에 모두 나온다
3. **빈 그룹 숨김(`hideEmptyGroups`)** — 우리는 `없음` 그룹을 항상 만든다
4. **`status` 옵션 그룹** — `To-do·In progress·Complete`, 그리고 `상태 is 그룹` 필터
5. **차트 뷰** — 지금은 대시보드 위젯(막대·도넛)만 있고 독립 차트 뷰가 없다. 쌓기·데이터 라벨·캡션 필요
6. **타임라인 옆 표** — `timeline_show_table`과 그 표만의 컬럼 목록, 확대 단위(`quarter`)
7. **행 추가 문구** — 노션은 그룹마다 `새 프로젝트`(데이터베이스별 "항목 이름"). 우리는 `새 페이지` 고정

## 원본을 건드리지 않기 위한 규칙

- 조작은 **읽기 전용 API 호출**과 hover, 뷰 탭 전환까지. 셀 클릭·행 추가·컬럼 드래그·설정 변경 없음
- **"빈 곳을 클릭해서 메뉴 닫기"는 금지.** 한 번 그렇게 했다가 사용자의 탭이 라이브러리로 이동했다.
  메뉴는 `Escape`로만 닫는다
- 접속 경로는 `scratchpad/cdp-lib.mjs` — 사용자 맥의 크롬(포트 9333)에 ssh 역터널로 붙는다
