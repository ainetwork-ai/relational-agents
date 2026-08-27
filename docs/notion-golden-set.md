# 원본(노션)에 붙는 방법 — 복붙용

Projects 페이지 작업의 기준은 **원본과의 차이 0**이다. 그래서 원본을 못 보면
그건 "일단 진행"이 아니라 **작업 중지**다. 아래는 붙는 절차 전부이고, 여기 적힌
명령은 모두 실제로 돌려본 것이다(2026-08-06).

## 0. 먼저 이것부터 (서버에서)

```bash
cd app && node e2e/golden.check.mjs
```

- **exit 0** → 잴 수 있다. 작업 시작.
- **exit 1** → 붙을 수 없다. **UI 코드를 만지지 말고** 아래 1·2를 사람에게 부탁한다.
  (스크립트가 부탁할 명령을 그대로 출력한다.)

이 스크립트는 터널만 보는 게 아니라 **탭이 JS 실행에 응답하는지**까지 본다. 탭이
멀쩡해 보이면서 렌더러가 멈춰 `Runtime.evaluate` 가 영영 안 돌아오는 일이 실제로
있었다(그때 `✗ 멈춤` 으로 찍힌다).

## 1. 맥에서 크롬 (터미널 A, 켜둔 채로)

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333 --user-data-dir=/tmp/cdp4
```

- `--user-data-dir` 는 **평소 프로필과 분리된 폴더**여야 한다. 안 그러면 이미 떠 있는
  크롬에 그냥 붙어버리고 `--remote-debugging-port` 가 조용히 무시된다.
- 같은 폴더를 계속 쓰면 노션 로그인이 남아 있다. 폴더가 지워졌으면 그 창에서 노션에
  한 번 로그인해야 한다(SSO라 사람이 직접 해야 한다).
- `bind() failed: Address already in use` → 그 포트를 쓰는 크롬이 이미 있다. 그걸 쓰거나,
  다른 포트로 띄우고 아래 터널 포트도 같이 바꾼다.
- **로그를 숨기지 말 것**(`>/dev/null` 금지). `DevTools listening on ws://127.0.0.1:9333/...`
  이 떠야 성공이고, 실패 원인도 거기 찍힌다.

## 2. 맥에서 역터널 (터미널 B, 켜둔 채로)

```
ssh -R 9333:127.0.0.1:9333 comcom@192.168.1.194
```

크롬 창을 띄운 터미널과 **다른 창**이어야 하고, 이 ssh 세션이 열려 있는 동안만
터널이 산다. 맥이 잠들거나 창을 닫으면 조용히 끊긴다 — 그래서 0번을 매번 돌린다.

## 3. 원본을 다룰 때의 규칙

원본은 회사 실데이터다. **바꾸지 않는다.**

- 해도 되는 것: 스크롤, 호버, 셀 클릭해서 메뉴 열기, 검색창에 타이핑(필터일 뿐),
  좌표·계산된 스타일 읽기, 스크린샷, 뷰 탭 전환.
- 하면 안 되는 것: 옵션/사람 **선택**, 행 추가·삭제, 드래그, 값 편집, 빈 곳 클릭으로
  메뉴 닫기(한 번 페이지가 이동한 적 있다 — 닫을 땐 **Escape**).
- 메뉴를 열었으면 재고 **Escape** 로 닫는다.

## 4. 붙어서 재는 코드

- 접속 헬퍼: `scratchpad/cdp-lib.mjs` (`attach()` → `ev/rect/click/key/shot/dom`).
  Playwright 의 `connectOverCDP` 는 이 크롬(150)에서 실패한다 — 원시 CDP 를 쓴다.
- 잴 때 조심할 것은 `docs/notion-projects-spec.md` 의 **"재보다 틀렸던 것들"** 에 있다.
  특히: `scrollIntoView()` 는 가로로도 스크롤한다 · 노션 표는 보이는 5칸만 DOM 에 둔다
  (`scrollLeft` 만 바꾸면 안 그려진다) · 호버는 **안 켜진 형제까지** 같이 읽어야 한다.
- 잰 값은 `app/e2e/fixtures/*.json` 에 넣고, 우리 쪽을 같은 방식으로 재서 대조하는
  `app/e2e/*.check.mjs` 를 함께 둔다. "고쳤다"의 근거는 그 스크립트의 exit 0 이다.

## 5. 지금 있는 대조 스크립트

| 명령 | 무엇을 대조하나 |
|---|---|
| `node e2e/golden.check.mjs` | 원본에 붙을 수 있나 (다른 것보다 먼저) |
| `node e2e/person-picker.check.mjs` | 사람 피커의 박스·바·선택항목·라벨·후보 행 |
| `node e2e/status-dropdown.check.mjs` | Status 셀 메뉴의 박스·바·칩·그룹·구분선·푸터·검색 2종 |
| `node e2e/status-edit-property.check.mjs` | 속성 편집 사이드바(도킹·헤더·그룹·옵션·푸터)와 옵션/그룹 메뉴, Esc 단계 |
| `node e2e/chip-consistency.check.mjs` | 같은 값의 칩이 셀과 메뉴에서 같은 모양인지 |
| `node e2e/view-columns.check.mjs` | 표의 열 순서·폭 13개 |
| `node e2e/table-right-edge.check.mjs` | 끝까지 스크롤했을 때 표 뒤 여백 |
| `node e2e/view-bar.check.mjs` | 뷰 탭 줄과 툴바(알약 탭·28×28 아이콘·분할 버튼) |
| `node e2e/row-gutter.check.mjs` | 가로 스크롤에서 행 컨트롤(체크박스·⠿)이 어디에 붙는지 |
| `node e2e/title-open.check.mjs` | 제목 셀 호버의 `열기` 버튼 |
| `node e2e/db-hover-scope.check.mjs` | 호버 시 켜지는 셀이 포인터가 있는 하나뿐인지 |
| `node e2e/sidebar-row.check.mjs` | 사이드바 행의 호버 버튼과 ⋯ 메뉴 |
| `node e2e/db-page-header.check.mjs` | 풀페이지 DB 머리: 커버 높이(20vh)·컨트롤 줄·아이콘+제목 한 줄·설명 위치 |
| `node e2e/rules-row.check.mjs` | 탭 아래 규칙 줄: 필터 버튼이 접고 펴는지(눌린 박스)·칩 24px·구분선·+ 필터 |
| `node e2e/sidebar-width.check.mjs` | 저장된 폭이 없을 때의 사이드바 폭(270)과 본문 시작 x |
| `node e2e/row-comment-badge.check.mjs` | 댓글 달린 행의 제목 셀 배지(20 높이·아이콘 16·제목 뒤 5·0이면 없음) |
| `node e2e/row-comment-popover.check.mjs` | 그 배지가 여는 480px 팝오버 — 배지 가운데 정렬, 아바타 24/이름 15.5/본문 38 |
| `ROW_PAGE_ID=… node e2e/page-comments-inline.check.mjs` | 페이지 안 `댓글` 섹션 — 안쪽 스크롤 없음, 한 칸 64, 멘션이 칩이 아님, 도킹 패널 없음 |
| `node e2e/notion-paste.check.mjs` | 노션 전체 복사 → 붙여넣기 (콜아웃·토글·볼드 런·체크·중첩·저장까지) |
| `node e2e/peek-inset.check.mjs` | 행 피크(사이드 페이지)의 폭 규칙과 콘텐츠 여백 76px |
| `node e2e/block-spacing.check.mjs` | 기본 블록의 세로 여백(문단 6/6, H1·H2·H3 상단 30/26/22), 리스트 첫 항목 규칙, 거터(+ −52, 6점 −28, 첫 줄 중앙), 6점 클릭 하이라이트(2px inset·리스트 1px), 구분선·코드·콜아웃 구조 — 페이지를 스스로 만들어 551개 체크 |
| `node e2e/plus-menu.check.mjs` | 거터 `+`: 내용 줄이면 아래 빈 줄, 빈 줄이면 그 줄에서 타입 메뉴 — "/" 없이, 캐럿 맨 앞, 필터 플레이스홀더 알약, 메뉴 324×396.8·간격 8·항목 32·푸터 42 |
| `node e2e/row-props.check.mjs` | 행 페이지의 속성 블록 — 사이드 피크와 전체 페이지 둘 다: 제목(32/38.4 · 40/48) → `세부 정보 보기`(28, 피크는 호버 때만) → 고정 속성 밴드(라벨 24 · 값 30 · min 80/max 200 · gap 8 · 32px 스크롤 화살표) → 댓글(24, 구분선) → 본문(8); 값을 누르면 뜨는 300px 메뉴(셀 -1/-1, 항목 28); 풀페이지 세부 정보 사이드바 385; 피크 세부 정보는 280 패널이 생기며 피크가 그만큼 왼쪽으로 넓어짐(창−400 상한) |
| `node e2e/row-props-live.check.mjs` | Evaluation 을 전체 페이지에서 바꾸면 다른 창의 피크·표 셀에, 피크에서 바꾸면 다른 창의 전체 페이지에 새로고침 없이 오는지 (dev 행 하나를 바꿨다 되돌린다) |
| `pnpm check:dismiss` | 포털 팝오버가 바깥클릭 감지를 직접 짜고 있지 않은지 |

`e2e/*.check.mjs` 는 dev 서버(3110)와 dev DB 를 쓰고, 세션 쿠키를 직접 만들어 붙는다.

dev DB 는 2026-08-27 이전에 다시 시드됐다 — 오래된 스크립트의 기본 `PAGE_ID`/`USER_ID`
(`af7fc488…`/`0be606ed…`)는 이제 없는 행이라 로그인 화면에 떨어지고 `[data-cellnav]` 를
기다리다 타임아웃한다. 지금 있는 것: Projects 페이지 `5722f40d-c3f6-4664-9bdb-5a24abe655cf`,
사용자 hyeonjj `8ccf17a7-24fb-4ae9-974c-94bf5db0cf85`. 환경변수로 넘기면 된다:

```bash
PAGE_ID=5722f40d-c3f6-4664-9bdb-5a24abe655cf USER_ID=8ccf17a7-24fb-4ae9-974c-94bf5db0cf85 node e2e/peek-inset.check.mjs
```
