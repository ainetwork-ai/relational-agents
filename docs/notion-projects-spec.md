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

표 뷰가 공통으로 들고 있는 값: **`table_frozen_column_index: -1` — 고정 컬럼 없음**
(확인: 원본에서 가로로 500px 밀면 첫 컬럼 `TL`의 x가 270 → −126으로 같이 움직인다.
한동안 이 값을 "기본값=첫 컬럼 고정"으로 잘못 읽고 첫 컬럼을 붙여뒀었다),
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

2026-08-06에 아래 1~7을 전부 구현했다. 각 항목 끝의 커밋을 보면 된다.

1. ~~**뷰별 컬럼 순서**~~ ✅ `ff28c0d` — `ViewConfig.propertyOrder`. 컬럼 드래그가 그 뷰의 순서만 바꾼다
2. ~~**`multi_select` 그룹**~~ ✅ `afd75f3` — 값이 여러 개인 행은 각 그룹에 모두 나온다
3. ~~**빈 그룹 숨김**~~ ✅ `afd75f3` — 뷰별 플래그, 기본 켜짐, 그룹 메뉴에서 토글
4. ~~**`status` 옵션 그룹**~~ ✅ `b605902`, `017541f` — `optionGroups`, `group:<이름>` 필터, 보드 컬럼의 밴드 라벨
5. ~~**차트 뷰**~~ ✅ `72b0a74` — 세로막대·가로막대·선·도넛, 개수/합계, 쌓기, 데이터 라벨, 캡션, 높이
6. ~~**타임라인 옆 표**~~ ✅ `7a20cd7` — 월/분기/연 확대, 창에 걸치는 막대, 옆 표
7. ~~**행 추가 문구**~~ ✅ `f368b85` — `databases.item_name`("프로젝트"), 모든 추가 버튼이 이 이름을 쓴다

작업하면서 추가로 드러난 것도 함께 고쳤다:

- **풀페이지 데이터베이스 설명** ✅ `ddef3b8` — 제목 아래 800자 산문. 컬럼·API는 있었는데 렌더링이 없었다
- **행 높이** ✅ `f368b85` — 원본은 어떤 값이 들어도 37px(`table_wrap: false`). 우리는 61px까지 늘어났다
- **첫 빈 칸 제거** ✅ `5804c85` — 체크박스는 표 밖 여백(`-36px`)에 걸린다
- **고정 컬럼은 뷰 설정대로** ✅ — `frozenColumnIndex`(기본 -1 = 고정 없음). 체크박스가 걸린
  폭 0짜리 앵커만 왼쪽에 남는다(원본도 그렇다)
- **가로 스크롤바** ✅ — 화면 하단 고정, 직접 그린 트랙·썸(이 브라우저의 오버레이 스크롤바는
  스크롤 중에만 보여서 표가 옆으로 더 있다는 걸 알 수 없었다)
- **행에 딸려가는 아이콘** ✅ — 원본은 제목 셀마다 컬렉션 아이콘(`/icons/iterate_blue.svg`)을
  넣는다. 행 하나가 문서 하나라서 데이터베이스 아이콘을 물려받는 것이고, **그 문서 안에 만든
  하위 문서는 물려받지 않는다.** 풀페이지 DB에선 그 아이콘이 곧 페이지 아이콘이라 우리는
  페이지 아이콘을 읽어 쓴다(별도 컬럼 없음)
- **사람 여러 명** ✅ `fc6bd1d` — `Assignee`는 여러 명을 담고, 넘치면 잘린다
- **뷰 탭 id** ✅ `b605902` — 타입으로 키를 잡아 표 뷰 4개가 충돌했다. 오버플로 문구도 `N개 더 보기`

### 아직 남은 것

- 제목 셀의 **댓글 수 배지**(`💬 3`) — 원본은 제목 셀 안에 `commentFilledSmall` svg와 개수를 같이
  넣는다. 행↔페이지 작업과 겹쳐서 손대지 않았다
- 행 호버의 **`Open comments`**
- 그룹 헤더의 이름이 노션은 **버튼**(눌러서 그룹 값 변경), 우리는 텍스트
- 사람 아바타 사진 — 우리 시드 사용자는 사진이 없어 이니셜로 뜬다

## dev에 같은 데이터 넣기

비교하려면 같은 값이 있어야 해서, 원본을 그대로 dev의 `ComCom > Projects`
(`cc027bcc-…`)에 넣었다. 생성기는 `scratchpad/gen-seed.mjs`이고 입력은 세 파일이다:
`chunk.json`(스키마·뷰 8개), `rows-normalized.json`(행 249건 — `queryCollection`으로 받아
노션 리치텍스트를 값으로 정규화), `notion-users.json`(사람 24명).

- 속성 23개, 행 249건, 뷰 8개, 사용자 24명. id는 이름/노션 id의 sha1이라 **다시 돌려도 같은 id**다
- 노션 사람 24명 중 dev에 없던 21명은 **dev 전용 사용자로 만들었다**(`email`/`google_sub` 없음 →
  로그인 불가). 이름을 보이게 하려는 목적이고 dev DB에만 있다
- 다시 넣으려면: `node gen-seed.mjs && psql -f seed.sql`, 그리고 설명은 `desc.sql`

## 원본을 건드리지 않기 위한 규칙

- 조작은 **읽기 전용 API 호출**과 hover, 뷰 탭 전환까지. 셀 클릭·행 추가·컬럼 드래그·설정 변경 없음
- **"빈 곳을 클릭해서 메뉴 닫기"는 금지.** 한 번 그렇게 했다가 사용자의 탭이 라이브러리로 이동했다.
  메뉴는 `Escape`로만 닫는다
- 접속 경로는 `scratchpad/cdp-lib.mjs` — 사용자 맥의 크롬(포트 9333)에 ssh 역터널로 붙는다
