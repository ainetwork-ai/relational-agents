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
- **행 아이콘** ✅ — 원본을 뜯어보니 규칙은 "DB 아이콘이 실시간으로 따라간다"가 아니다.
  **행마다 자기 페이지가 `format.page_icon`을 들고 있다**: Projects의 행 100건 중 99건이
  `/icons/iterate_blue.svg`(=DB 아이콘), 1건은 `/icons/anchor_blue.svg`로 개별 변경돼 있다.
  즉 **행을 만들 때 DB 아이콘이 복사되고 이후 행별로 바꿀 수 있다** — 그래서 그 문서 안에
  만든 하위 문서에는 안 따라간다. 다른 DB로 확인: `Master`(🎖)의 행은 일반 페이지 글리프,
  `모두연 유지보수`의 행은 아이콘 없음. 그리고 **뷰마다 `show_page_icon` 토글**이 있어서
  원본은 `My`·`All Projects`·`My Timeline`에서 끈다.
  우리는 뷰 토글(`showPageIcon`)을 그대로 반영했고, 행이 아직 자기 아이콘을 못 가지므로
  DB(=풀페이지 페이지) 아이콘을 대신 쓴다. 행↔페이지가 붙으면 행 아이콘 우선으로 바꾸면 된다
- **사람 여러 명** ✅ `fc6bd1d` — `Assignee`는 여러 명을 담고, 넘치면 잘린다
- **뷰 탭 id** ✅ `b605902` — 타입으로 키를 잡아 표 뷰 4개가 충돌했다. 오버플로 문구도 `N개 더 보기`

### 셀 hover 액션 (원본 측정, 2026-08-06)

행을 hover하면 **제목 셀에 `열기`**(aria `사이드 보기에서 열기`, 51×20)가 항상 뜨고, **지금
가리키고 있는 컬럼의 셀**에 그 타입의 액션이 붙는다. 오른쪽 끝에서 7px, 버튼은 24×20.
**값이 없는 셀에는 아무것도 안 뜬다.**

| 속성 타입 | hover 시 |
|---|---|
| `title` | `열기` + 페이지 아이콘(22×22) + 댓글 수 배지(34×20, 항상 표시) |
| `person`·`status`·`select`·`multi_select` | `댓글` |
| `date` | `댓글` + `클립보드에 복사` |
| `number` | `댓글` + `클립보드에 복사` |
| `created_time` (읽기 전용) | **`클립보드에 복사`만** — 댓글 없음 |
| 값이 빈 셀 | (없음) |

우리 구현: **측정된 타입에만** 위 배치를 넣었다. `클립보드에 복사`는 실제로 동작하고, `댓글`은
셀 댓글이 없어 비활성(이유는 툴팁).

**아직 측정 못 한 타입 — 구현하지 않았다** (hover해도 아무것도 안 뜬다):
`text` · `url` · `email` · `phone` · `checkbox` · `files` · `relation` · `rollup` · `formula` ·
`last_edited_time` · `created_by` · `last_edited_by`.
원본 Projects에서 이 타입들은 화면에 보이는 행에 값이 없었고(뒤쪽 컬럼이라 가로 스크롤도
필요했다), 값 있는 셀을 찾지 못했다. 추측으로 넣지 않는다 — 한 번 그렇게 했다가 셀에 없는
버튼을 만들었다.

**다시 측정하는 법**: 노션 표는 행마다 **보이는 5칸만** DOM에 둔다. `scrollLeft`만 바꾸면
가상화가 돌지 않아 뒤쪽 컬럼이 안 그려진다 — `scrollLeft`를 바꾼 뒤 그 스크롤러에
`new Event('scroll', { bubbles: true })`를 디스패치해야 렌더된다. 그 다음 값이 있는 행과 없는
행을 각각 hover해서 셀 안의 보이는 버튼(`[role=button]`)을 읽으면 된다.

### 아직 남은 것

- 제목 셀의 **댓글 수 배지**(`💬 3`) — 원본은 제목 셀 안에 `commentFilledSmall` svg와 개수를 같이
  넣는다. 행↔페이지 작업과 겹쳐서 손대지 않았다
- 행 호버의 **`Open comments`**
- 그룹 헤더의 이름이 노션은 **버튼**(눌러서 그룹 값 변경), 우리는 텍스트
- 사람 아바타 사진 — 우리 시드 사용자는 사진이 없어 이니셜로 뜬다
- Status 드롭다운의 **빈 셀** 상태 — 이 뷰의 249행이 전부 값을 갖고 있어 열어볼 수가 없었다
- Status 드롭다운의 **다크 테마**, `속성 편집`이 원본에서 무엇을 여는지, gray/blue/red/yellow/green
  이외 색의 칩 색값 — 화면에 없어서 못 쟀다
- select / multi_select **셀 칩의 원본 수치** — status 칩만 쟀다. 셀 칩도 드롭다운 칩과 같은
  모양으로 통일했지만(아래), 그 통일은 *지시*이지 측정이 아니다. 원본 캡처상 select 칩에는
  점이 없어서 점은 status 에만 붙인다

## dev에 같은 데이터 넣기

비교하려면 같은 값이 있어야 해서, 원본을 그대로 dev의 `ComCom > Projects`
(`cc027bcc-…`)에 넣었다. 생성기는 `scratchpad/gen-seed.mjs`이고 입력은 세 파일이다:
`chunk.json`(스키마·뷰 8개), `rows-normalized.json`(행 249건 — `queryCollection`으로 받아
노션 리치텍스트를 값으로 정규화), `notion-users.json`(사람 24명).

- 속성 23개, 행 249건, 뷰 8개, 사용자 24명. id는 이름/노션 id의 sha1이라 **다시 돌려도 같은 id**다
- 노션 사람 24명 중 dev에 없던 21명은 **dev 전용 사용자로 만들었다**(`email`/`google_sub` 없음 →
  로그인 불가). 이름을 보이게 하려는 목적이고 dev DB에만 있다
- 다시 넣으려면: `node gen-seed.mjs && psql -f seed.sql`, 그리고 설명은 `desc.sql`

## Status 드롭다운 — 원본 수치와 대조 (2026-08-06)

값이 있는 Status 셀을 열어 실제로 잰 값이고, 같은 숫자가
`app/e2e/fixtures/notion-status-dropdown.json`에 있다.
`node app/e2e/status-dropdown.check.mjs`가 우리 것을 다시 재서 이 파일과 대조한다
(다르면 `우리 x / 노션 y` 형태로 전부 찍고 exit 1).

- 박스: 240×376, radius 6, 흰 배경, **셀을 덮는다**(셀 좌상단 기준 −1,−1). 우리는 176px 박스가
  셀 아래에 붙어 있었다
- 상단 바: 240×39, `rgba(242,241,238,.6)`, 선택값 칩 + 검색 입력(14px)
- 그룹: 라벨 12px/500 `rgb(125,122,117)` x=12, 그룹 사이 1px 구분선(x=12 w=216
  `rgba(42,28,0,.07)`), 이름은 한국어 UI라 **할 일 / 진행 중 / 완료**
- 옵션 행: 232×28 x=4 radius 6, 칩은 x=12 알약(radius 10, 높이 20, 8px 점, 라벨 14px)
- 하단: 구분선 + 36px 행에 슬라이더 아이콘(20px, x=12) + `속성 편집`(x=40, 14px)
- 검색 중에는 **그룹 라벨이 사라지고** 결과만 4px 아래에 뜬다. 일치하는 게 없으면 바와
  `속성 편집`만 남는다 — **옵션을 만들어 주지 않는다**
- 원본에 **없는 것**: `Clear` 행(칩에 호버해도 ✕가 없다), 옵션별 그룹 `<select>`(우리가 지어낸
  것이다). 둘 다 지웠다
- 강조(hover/키보드) 배경은 `rgba(33,27,23,.051)`이고, **검색 전에는 어떤 행도 강조되지 않는다**

## 칩은 컴포넌트 하나

`components/database/option-chip.tsx` 의 `OptionChip` 하나만 쓴다. 셀, Status 메뉴,
보드 열 머리글, 필터 칩, 리스트/갤러리/캘린더 값이 전부 이걸 부른다.

모양은 **Status 드롭다운에서 잰 칩**이다 — 높이 20, radius 10(알약), padding 7/9,
라벨 14px, status 는 라벨 앞에 8px 점(간격 5px). 색은 측정한 다섯 가지(gray/blue/red/
yellow/green)를 쓰고, 나머지 네 색은 아직 못 재서 기존 `OPTION_COLORS` 클래스로 떨어진다.

한때 셀 칩(12px 사각)과 메뉴 칩(20px 알약)이 따로 있어서 같은 값이 화면에서 두 가지로
보였다. `node app/e2e/chip-consistency.check.mjs` 가 **같은 값을 셀에서 한 번, 메뉴에서
한 번 재서 서로 비교**하고(높이·radius·배경·패딩·점 크기/색/간격·라벨 크기/색/행간),
덤으로 그 모양이 노션 픽스처와 같은지도 본다. 갈라지면 `셀 x / 메뉴 y` 로 찍고 exit 1.

## 사람 피커 — 원본 수치와 대조 (2026-08-06)

TL(250px 셀) · Sherpa(117px **빈** 셀) · Assignee(469px 셀) 세 개를 열어 쟀다.
같은 숫자가 `app/e2e/fixtures/notion-person-picker.json`, 대조는
`node app/e2e/person-picker.check.mjs`.

- 폭은 셀 폭이 **아니다**: `max(240, 셀 폭)`. 117px 셀에서도 240이 나온다(우리는 220이었다)
- 높이는 **항상 333**, 리스트가 안에서 스크롤. 셀을 덮고(−1,−1), radius 6
- 상단 바: `rgba(242,241,238,.6)`, radius 6, 최대 240까지 늘어나며 스크롤.
  빈 셀이면 높이 **39**, 한 줄이면 **63**
- 바 안의 선택된 사람: **칩 배경이 없다**. 아바타 20 → 6px → 이름 **14px** → 2px →
  `항목 제거` 버튼 20×20(아이콘 12). 줄 간격 24, 첫 줄 y=9, 아래 여백 10.
  입력은 남은 자리를 차지한다(높이 20, 14px)
- 라벨 `원하는 만큼 선택`: x=12, 12px/500, 바 아래 10px
- 후보 행: x=4, 높이 28, 간격 **29**, 아바타 20@x12, 이름 14px@x40, 라벨 아래 9px
- 본인에게는 이름 바로 뒤에 `(나)`

우리가 틀렸던 것: 폭 하한 220, 위치 +1/+4, radius 8, 회색 바 없음, 선택된 사람을
12px 글씨의 회색 칩으로, 검색창을 칩 아래 별도 줄에, 라벨 11px에 x=1.

## 행 컨트롤과 가로 스크롤 (2026-08-06)

스크롤 위치 0 / 400 / 1250 에서 행에 호버해 쟀다
(`app/e2e/fixtures/notion-row-gutter.json`, 대조는 `node app/e2e/row-gutter.check.mjs`).

- 스크롤 전: 컨트롤은 표 왼쪽 여백에 있다 — ⠿ 는 행 시작 **−62**, 체크박스 **−26**
  (원본 순서는 왼쪽부터 `+`, `⠿`, `☐`. 우리에겐 `+`가 없다)
- 스크롤하면: 컨트롤이 스크롤러 왼쪽 끝으로 붙는다. **체크박스만 스크롤러+11** 에 남고
  (셀 위에 살짝 겹친다 — 원본도 그렇다), **⠿ 는 스크롤러 바깥**으로 나가 보이지 않는다
- 우리가 틀렸던 것: `sticky left-0` 이라 컨트롤이 **표 왼쪽 끝에 고정**돼 있었고, 스크롤하면
  셀 내용이 그 밑으로 흘러 이름 위에 체크박스가 얹혔다
- 원본의 aria-label(그대로 쓴다): ⠿ 는 `드래그하여 이동하고 클릭하여 메뉴를 여세요`,
  `+` 는 `블록을 아래에 추가하려면 클릭하고 위에 추가하려면 Option + 클릭하세요.`,
  체크박스는 **라벨이 없다**(우리는 접근성 때문에 `Select row` 를 남겨둔다)
- 고친 방법: sticky 자식은 스크롤포트의 **콘텐츠 박스**(= full-bleed 패딩만큼 안쪽)에 붙는다.
  그래서 앵커의 `left` 를 `37px − 표의 왼쪽 인셋`(`--db-inset`, `useFullBleed` 가 쓴다)으로 주면
  안 붙었을 때는 행을 따라가고, 붙을 때는 스크롤러+37 에 서서 위 수치가 그대로 나온다

## 뷰 탭 줄과 툴바 (2026-08-06)

표 위의 한 줄. 왼쪽은 뷰 탭, 오른쪽은 툴바다(창 1200×870에서 쟀다,
`app/e2e/fixtures/notion-view-bar.json`, 대조는 `node app/e2e/view-bar.check.mjs`).

- 활성 탭: **알약** 32높이 radius 20, 배경 `rgba(33,27,23,.05)`, 안쪽 여백 12,
  아이콘 20, 간격 6, 라벨 **14px/500** `rgb(44,44,43)`. 탭 안에 `⋯` 는 **없다**
- 비활성 탭: 배경 없음, 같은 크기, 라벨 색 `rgb(125,122,117)`
- 넘침: `N개 더 보기` 32높이 알약, 14px/400, **캐럿 없음**
- 툴바: **28×28 아이콘 버튼 6개**(radius 6, 아이콘 16, 28px 간격) —
  필터 · 정렬 · 자동화 · AI 자동 채우기 · 검색 · 설정. **개수 배지는 없고**,
  활성 표시는 배경이 아니라 **아이콘이 파래지는 것**(`rgb(39,131,222)`)
- 주 버튼: `새로 만들기` **분할 버튼** 80×28 + 캐럿 24×28, radius 6,
  배경 `rgb(39,131,222)`. (그룹의 add-row 가 `새 프로젝트`다 — 둘을 헷갈리지 말 것)

눌러본 동작:

- **필터/정렬** → 탭 줄 아래에 칩 바가 **토글**된다: `↑ End date ⌄` ·
  `Status: In progress,Needs… ⌄` · `+ 필터`, 그리고 버튼에 눌린 표시가 남는다.
  우리는 이 바가 **항상** 떠 있다 (아직 안 고침)
- **자동화** / **AI 자동 채우기** → 483×642 패널
- **활성 탭 클릭** → 그 뷰의 메뉴
- 못 잼: **검색**·**설정** 패널(클릭해도 패널을 못 잡았다), 탭 메뉴 항목, 호버 상태

우리에게 아직 없는 것: 툴바 버튼 6개 중 자동화·AI 자동 채우기·검색(우리는 3개 + `⋯`),
그리고 캐럿 메뉴(템플릿).

## 표의 오른쪽 끝 (2026-08-06)

원본을 가로로 끝까지 밀면 마지막 열 뒤에 `+` 열(56px)과 **페이지 여백**이 남는다
(창 1443일 때 마지막 열 오른쪽 1617, 스크롤러 콘텐츠 오른쪽 1713 → **96px**).
우리 표는 오른쪽 여백이 아예 없어서 창 끝에 딱 붙어 끝났고, 그래서 "끝까지
스크롤이 안 된다"고 느껴졌다 — 끝이 없었던 것이다.

`useFullBleed` 가 왼쪽에만 넣던 인셋을 **오른쪽에도** 넣는다(현재 104px).
대조는 `node app/e2e/table-right-edge.check.mjs` — 끝까지 스크롤되는지, 마지막
열이 잘리지 않는지, 표 뒤 페이지 여백이 96±16 인지 본다. 원본 96 vs 우리 104 의
8px 차이는 쫓지 않았다(왼쪽 인셋도 104다).

## 제목 셀 — 호버 · 클릭 · 열기 (2026-08-06)

`app/e2e/fixtures/notion-title-cell.json`, 대조는 `node app/e2e/title-open.check.mjs`.

- 호버하면 셀 오른쪽 끝에서 5px 안쪽에 **흰 패드 55×24**(radius 6, padding 2,
  그림자 3겹 `rgba(25,25,25,.027) 0 8px 12px` + `0 2px 6px` + `rgba(42,28,0,.07) 0 0 0 1px`)가
  뜨고, 그 안에 **51×20 버튼**(radius 4, padding 0 4, gap 6). 아이콘 15px
  `rgb(142,139,134)`, 라벨 `열기` **12px/500** `rgb(125,122,117)`,
  aria-label 은 `사이드 보기에서 열기`
- **제목 글자를 클릭하면 셀 안에서 바로 편집**된다(contenteditable). 페이지가 열리지 않는다
- **열기를 누르면** 오른쪽 도킹 사이드 보기 (그 창에서 x=1128 w=600 전체 높이)
- 셀 자체: padding `7.5px 8px`, 아이콘 20px, 제목 14px

우리가 틀렸던 것: 11px 테두리 칩이었고, 무엇보다 **호버해도 아예 안 떴다** —
버튼은 `group-hover/dbcell` 을 보는데 제목 셀은 `group/titlecell` 을 선언한다.
게다가 `열기` 는 셀이 아니라 **행**에 딸린 버튼이다(원본은 행 어디에 올려도 뜬다).
`db-hover-scope.check.mjs` 가 이걸 못 잡았던 이유도 적어둔다: 버튼이 아니라 그
부모(셀)의 opacity 를 읽고 있었다 — 셀은 언제나 1이다.

## 사이드바 페이지 행 (2026-08-06)

`app/e2e/fixtures/notion-sidebar-row.json`, 대조는 `node app/e2e/sidebar-row.check.mjs`.

- 호버하면 버튼은 **세 개**뿐이다(각 20×20, radius 4): `열기`(펼치기 화살표, 아이콘 12 —
  평소엔 페이지 아이콘 자리) · `삭제, 복제 등…`(⋯, 아이콘 16) · `하위 페이지 추가`(+, 아이콘 16)
- **여섯 점 손잡이는 없다.** 순서 변경은 행 자체를 끌어서 한다 → 우리도 손잡이를 없애고
  드래그를 행에 붙였다(행 안의 button/input 위에서 시작한 것은 드래그로 치지 않는다)
- 우리 버그: 액션을 `group-hover:flex` 로만 보이게 해서, 포인터가 ⋯ 메뉴로 가는 순간
  트리거가 `display:none` 이 되고 **CSS 앵커가 사라져 메뉴가 접혔다** — 항목을 누를 수가
  없었다. 메뉴가 열려 있는 동안에는 액션을 계속 배치해 둔다

## 재보다 틀렸던 것들 — 같은 실수를 반복하지 않으려고 적는다

전부 실제로 한 번씩 틀린 것이고, 옆에 "어떻게 확인하면 되는지"를 같이 적었다.

1. **`scrollIntoView()`는 가로로도 스크롤한다.** 표를 화면에 올리려고 부른 뒤 좌표를 읽어서
   표의 왼쪽 끝을 104px 왼쪽으로 착각했고, 그 값으로 레이아웃을 바꿔 시작 위치를 깨뜨렸다.
   → 재기 전에 `scroller.scrollLeft = 0` 으로 리셋하고, 세로만 움직여라.
2. **노션 표는 행마다 보이는 5칸만 DOM에 둔다.** 게다가 `scrollLeft`만 바꾸면 가상화가 돌지
   않아 뒤쪽 컬럼이 영영 안 그려진다. → `scrollLeft` 변경 뒤 그 스크롤러에
   `dispatchEvent(new Event('scroll', { bubbles: true }))`.
3. **DOM에 있다 ≠ 화면에 보인다.** `cell.querySelectorAll('button')` 으로 "셀마다 버튼이 붙었다"고
   판단했는데, 실제로는 행 오른쪽 끝(2,900px 밖)에 그려지고 있었다. → 붙었는지가 아니라
   **좌표**를 재라: `cellRect.right - buttonRect.right`.
4. **`absolute` 는 positioned 조상을 찾는다.** 셀에 `relative` 가 없으면 행 기준이 된다. 제목 셀만
   `relative` 라서 `열기`만 제대로 보였다.
5. **포털은 ref 바깥이다.** 팝오버를 `createPortal` 로 옮긴 뒤에도 바깥클릭 감지가 `ref` 만
   보고 있어서, 팝오버 안을 누르는 순간 mousedown 에서 닫혔고 클릭이 도달하지 못했다(사람 선택이
   안 먹던 원인). → 포털 노드의 ref 도 같이 검사.
6. **"hover 시 변화 없음"은 배경색만 본 결론이었다.** 노션은 행에 색을 칠하지 않는 대신 **버튼**을
   띄운다. → 배경/보더뿐 아니라 그 순간 보이는 `[role=button]` 을 세라.
7. **폭에 따라 기하가 달라진다.** 페이지가 `max-width + mx-auto` 로 가운데 정렬이면 창을 넓힐수록
   시작 위치가 밀린다. 좁은 창에서만 확인하고 "고쳤다"고 세 번 말했다. → 최소 3개 폭
   (1200/1600/2400)에서 재라.
8. **값이 있는 셀과 빈 셀은 UI가 다르다.** 빈 셀은 hover 해도 아무것도 안 뜬다. → 두 경우를 다 보라.
9. **호버 어포던스에는 "범위"가 있고, 범위는 켜진 것이 아니라 *안 켜진 것*을 봐야 보인다.**
   댓글은 포인터가 있는 **셀 하나**, 열기는 **행 전체**인데 둘 다 행의 hover 그룹
   (`group-hover/dbrow`)에 걸어서, 아무 셀에나 올려도 그 행의 모든 셀에 댓글 버튼이 떴다.
   내가 확인한 셀은 늘 정답이었기 때문에(버튼이 있고, 위치도 맞고) 몇 번을 재도 통과였다.
   → 호버 상태를 잴 때는 **호버한 것과 호버하지 않은 형제들을 같은 순간에 함께** 읽어라.
   `e2e/db-hover-scope.check.mjs` 가 이걸 자동으로 확인한다(셀마다 hover → 켜진 셀 목록이
   자기 자신 하나인지, 열기는 계속 켜져 있는지). 같은 종류의 누수를 커밋 e94e05f 도 겪었다
   (`group-hover/block` 이 조상까지 켜던 문제) — 그룹 hover 는 **조상 전부**에 걸린다는 것을
   기억할 것.

## 원본을 건드리지 않기 위한 규칙

- 조작은 **읽기 전용 API 호출**과 hover, 뷰 탭 전환까지. 셀 클릭·행 추가·컬럼 드래그·설정 변경 없음
- **"빈 곳을 클릭해서 메뉴 닫기"는 금지.** 한 번 그렇게 했다가 사용자의 탭이 라이브러리로 이동했다.
  메뉴는 `Escape`로만 닫는다
- 접속 경로는 `scratchpad/cdp-lib.mjs` — 사용자 맥의 크롬(포트 9333)에 ssh 역터널로 붙는다
