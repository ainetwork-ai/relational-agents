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
- **다크 테마**는 워크스페이스 설정을 바꾸지 않고 잰다(설정을 바꾸면 다른 세션의 탭까지 다크가 된다).
  `Target.createTarget({newWindow:true})` 로 **내 탭을 새 창에** 만들고, 그 CDP 세션에서
  `Emulation.setEmulatedMedia({features:[{name:'prefers-color-scheme',value:'dark'}]})` — 노션은
  시스템 설정을 따르므로 그 탭만 다크가 된다(2026-09-09, `scratchpad/dark-colormenu.mjs`). 조심할 것:
  (1) 세션이 끊기면 에뮬레이션이 풀린다 — 한 연결에서 끝까지 잰다. (2) 노션이 `localStorage.theme`
  에 결과를 캐시하므로 끝나면 `light` 로 되돌려 확인한다. (3) 내 창이 **다른 창에 완전히 가리면**
  `visibilityState: hidden` 이 되어 `Input.dispatchMouseEvent` 가 영영 안 돌아온다 —
  `Browser.setWindowBounds` 로 상대 창과 겹치지 않는 띠를 남기고, 상대 창을 완전히 덮지도 않는다.
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
| `node e2e/chip-dark.check.mjs` | 라이트·다크 두 테마에서 칩 10색의 배경·글자·점, 그리고 속성 편집 색 메뉴의 스와치·링이 원본 값과 같은지 |
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
| `ROW_PAGE_ID=… node e2e/comment-collapse.check.mjs` | 댓글이 4개부터 접히는 규칙 — 첫 개·마지막 개만 남고 `답글 (총−2)개 더 보기` |
| `node e2e/ime-enter.check.mjs` | 한글 조합 중 Enter 가 댓글을 보내지 않는지 (조합 확정 후 1건) |
| `ROW_PAGE_ID=… node e2e/comment-attachment.check.mjs` | 댓글 클립 — 다중 선택·확장자 제한 없는 선택창, 칩, 파일만으로도 전송, 저장·렌더 |
| `node e2e/notion-paste.check.mjs` | 노션 전체 복사 → 붙여넣기 (콜아웃·토글·볼드 런·체크·중첩·저장까지) |
| `node e2e/peek-inset.check.mjs` | 행 피크(사이드 페이지)의 폭 규칙과 콘텐츠 여백 76px |
| `node e2e/table-block-menu.check.mjs` | 표 블록의 ⠿(거터 손잡이) 메뉴: 표 블록에만 붙는 `표` 묶음, `제목 행`/`제목 열` 스위치(30×18)가 각자 자기 축을 켜는지, 우리가 더한 `정렬`(표 전체)이 보이고 저장되는지 |
| `node e2e/table-grip.check.mjs` | 표의 행·열 그립: 회색 선(18×2)이 켜지는 규칙(선택의 왼쪽위 셀 + 호버 셀), 호버 시 6점 버튼(22×14 / 14×22), 클릭 시 행·열 전체 선택 + 파란 버튼 + 드롭다운(265폭·항목 28), 끌어서 행·열 옮기기(고스트 0.9 + 3px 파란 표시선), 드롭다운 UI(265×radius10·3겹 그림자·검색줄·아이콘 20@8·라벨@36·제목 행 스위치 30×18·⌘D·색 화살표)와 `색` 서브메뉴(220폭·스와치 26·텍스트10+배경10), 제목 토글(첫 행·첫 열 그립에만; 열 그립은 제목 **열**), 그리고 **원본에 없는** 정렬 항목(§menu.ours — 지우지 말 것) |
| `node e2e/table-cellnav.check.mjs` | 표 블록 안의 캐럿 이동(방향키·Tab, 셀 안 줄 → 위·아래 셀 → 표 밖)과 셀 범위 선택(드래그·Shift+방향키·Escape), 파란 테두리 2px/rgb(39,131,222)·오른쪽 변 손잡이 6×12, 셀 안 드래그는 텍스트 선택 + 서식 툴바 |
| `node e2e/block-spacing.check.mjs` | 기본 블록의 세로 여백(문단 6/6, H1·H2·H3 상단 30/26/22), 리스트 첫 항목 규칙, 거터(+ −52, 6점 −28, 첫 줄 중앙), 6점 클릭 하이라이트(2px inset·리스트 1px), 구분선·코드·콜아웃 구조 — 페이지를 스스로 만들어 551개 체크 |
| `node e2e/plus-menu.check.mjs` | 거터 `+`: 내용 줄이면 아래 빈 줄, 빈 줄이면 그 줄에서 타입 메뉴 — "/" 없이, 캐럿 맨 앞, 필터 플레이스홀더 알약, 메뉴 324×396.8·간격 8·항목 32·푸터 42 |
| `node e2e/row-props.check.mjs` | 행 페이지의 속성 블록 — 사이드 피크와 전체 페이지 둘 다: 제목(32/38.4 · 40/48) → `세부 정보 보기`(28, 피크는 호버 때만) → 고정 속성 밴드(라벨 24 · 값 30 · min 80/max 200 · gap 8 · 32px 스크롤 화살표) → 댓글(24, 구분선) → 본문(8); 값을 누르면 뜨는 300px 메뉴(셀 -1/-1, 항목 28); 풀페이지 세부 정보 사이드바 385; 피크 세부 정보는 280 패널이 생기며 피크가 그만큼 왼쪽으로 넓어짐(창−400 상한) |
| `node e2e/band-props.check.mjs` | 고정 속성 밴드의 **무엇이 나오나** — 행이 달라도 같은 집합·순서(빈 값도 자리 유지), 사람이 여러 명이면 칩 1개 + `+ N`(값 높이 31), 항목 폭 clamp(max(라벨, 값), 80, 200)이 창 폭·표면과 무관한지, 화살표(넘칠 때만·한 번에 clientW−200), 피크와 풀페이지가 같은 규칙인지 |
| `node e2e/prop-label-menu.check.mjs` | 속성 **라벨을 누르면** 나오는 메뉴 — 밴드(220×168: 이름 바꾸기·속성 편집·댓글 ǀ 속성 삭제 ǀ 레이아웃)와 패널(220×197: 이름 바꾸기·속성 편집 ǀ 속성 표시 여부·속성 복제·속성 삭제 ǀ 레이아웃)이 서로 다른 목록인 것, 속성 편집 팝오버(290×253), 속성 표시 여부 하위 메뉴(180×94) |
| `node e2e/row-props-live.check.mjs` | Evaluation 을 전체 페이지에서 바꾸면 다른 창의 피크·표 셀에, 피크에서 바꾸면 다른 창의 전체 페이지에 새로고침 없이 오는지 (dev 행 하나를 바꿨다 되돌린다) |
| `pnpm check:dismiss` | 포털 팝오버가 바깥클릭 감지를 직접 짜고 있지 않은지 |
| `node e2e/save-protocol.check.mjs` | 저장 프로토콜 1·2단계(`docs/save-protocol-target.md` §7): 227블록 한글 페이지에서 글자 하나 → 요청 ≤2KB·동시 진행 1, 2블록 페이지에서 입력→fetch ≤50ms, 응답 후 500ms 배치, 오프라인 5타 → IndexedDB 5건·`오프라인` 배지·5.0s 재시도 같은 id·복귀 후 0건, `/api/saveTransactions` 응답 `{}`·같은 요청 2회 → 블록 1개, 탭 닫기(온라인/오프라인) → 살아 있는 탭이 ≤20초 안에 회수·전송, 다른 탭의 편집·삭제가 GET 없이 SSE 트랜잭션으로 도착 — 페이지를 스스로 만들고 지운다. `ONLY6=1` 이면 팬아웃 부분만 |

`e2e/*.check.mjs` 는 dev 서버(3110)와 dev DB 를 쓰고, 세션 쿠키를 직접 만들어 붙는다.

dev DB 는 2026-08-27 이전에 다시 시드됐다 — 오래된 스크립트의 기본 `PAGE_ID`/`USER_ID`
(`af7fc488…`/`0be606ed…`)는 이제 없는 행이라 로그인 화면에 떨어지고 `[data-cellnav]` 를
기다리다 타임아웃한다. 지금 있는 것: Projects 페이지 `5722f40d-c3f6-4664-9bdb-5a24abe655cf`,
사용자 hyeonjj `8ccf17a7-24fb-4ae9-974c-94bf5db0cf85`. 환경변수로 넘기면 된다:

```bash
PAGE_ID=5722f40d-c3f6-4664-9bdb-5a24abe655cf USER_ID=8ccf17a7-24fb-4ae9-974c-94bf5db0cf85 node e2e/peek-inset.check.mjs
```
