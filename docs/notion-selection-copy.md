# 노션 드래그 선택 · 복사 — 측정 (2026-09-09)

comcom 제보: "prod에서 드래그해서 ⌘C 하니까 복사가 안 되고, 드래그할 때 선택됨 표시도 노션과 다르다."
원본을 CDP 로 **실제 마우스 드래그**해 잰 것. 읽기 전용(드래그·Escape·⌘C, 그리고 주입한
`<textarea>` 에 ⌘V 로 클립보드를 읽음 — 노션 본문에는 아무것도 붙이지 않음). 잰 페이지:
`Uncommon Gallery`(이미지 있음), `노션 Project Page 개발 문서`(단일 열 목록). 스크립트:
세션 scratchpad `m9-select.mjs`, `m11-select.mjs`, `m12-A.mjs`; 원자료 `notion-selection-measure-*.json(l)`.

## 1. 선택 모델 — 두 가지 상태, 전환 조건

| 시작 | 끌어간 곳 | 결과 상태 | 표시 |
|---|---|---|---|
| A 텍스트 안 | 같은 블록 안 | **텍스트 선택**(네이티브) | `::selection` `rgba(35,131,226,0.28)` |
| B·C 텍스트 안 | 다른 텍스트 블록(2·3개) | **텍스트 선택이 블록을 넘어 이어짐** — 블록 선택으로 바뀌지 않음 | 같은 파란 텍스트 하이라이트, halo 없음 |
| H 텍스트 안 | 마지막 블록을 지나 아래 여백까지 | 여전히 텍스트 선택 | 〃 |
| D 텍스트 안 | **이미지(비텍스트 블록)에 닿음** | **블록 선택으로 전환** — 이미지를 품은 블록(부모 불릿)이 통째로 선택 | halo |
| E 여백(본문 열 바깥) | 블록 위로 스윕(위→아래, 아래→위 둘 다) | **블록 선택**, 드래그 중 halo 가 실시간으로 늘어남. 러버밴드 사각형 요소는 **없음** | halo |
| F 이미지 클릭 | — | 블록 선택 | halo |
| G 텍스트에 캐럿 → Escape | — | halo 0. 복사하면 **페이지 전체**가 나옴(페이지 블록이 선택된 것으로 보임) — 확정 아님 | — |

- **핵심**: 텍스트에서 시작한 드래그는 텍스트 블록만 지나는 동안 **끝까지 텍스트 선택**이다.
  블록 선택으로 넘어가는 건 (1) 비텍스트 블록에 닿을 때, (2) 여백에서 시작할 때, (3) 비텍스트 블록 클릭.
- 우리 앱은 텍스트 드래그가 **다른 블록에 들어가는 순간 블록 선택으로 전환**한다(`block-editor.tsx`
  `onEditorMouseDown`) — B·C·H 에서 노션과 다름.

## 2. 블록 선택 표시(halo) — 계산된 스타일

`.notion-selectable-halo`(각 선택 블록 안에 절대 배치되는 오버레이):

| 속성 | 값 |
|---|---|
| background | `rgba(35, 131, 226, 0.14)` |
| border-radius | `4px` |
| border / box-shadow | 없음 |
| inset | 위 1–2px · 좌우 2px · 아래 1–2px (블록 유형별: 이미지 `2px`, 불릿 `1px 2px 2px`, 번호목록 `2px 2px 1px`) |

우리 앱: `bg-blue-100/80 ring-1 ring-inset ring-blue-300/70` — 색·ring 둘 다 다름.

텍스트 선택 색 `::selection`: `rgba(35, 131, 226, 0.28)` (우리 앱: 브라우저 기본).

## 3. ⌘C 가 클립보드에 넣는 것

| 상태 | `text/plain` | `text/html` | 내부 포맷 |
|---|---|---|---|
| A 한 블록 안 일부 텍스트 | 선택한 글자 그대로 | 글자 그대로(태그 없음) + `<!-- notionvc -->` | `text/_notion-text-production` `{blockType, editing, selection:{startIndex,endIndex}, action:"copy"}` |
| B·C·H 블록을 넘는 텍스트 | **마크다운**: `### 제목`, `- 불릿`, `1. 번호`, 들여쓰기 4칸으로 자식 표현, 블록 사이 빈 줄 | 시맨틱 HTML: `<h3>`, `<ul><li>`, `<ol start="2">`, 링크 `<a href>` 유지, 중첩 `<ul>` | `text/_notion-multi-text-production` `{blockSelection:{blocks:[{blockId, blockSubtree…}]}}` (부분 텍스트 반영) |
| D·E·F 블록 선택 | 마크다운, **자식 블록 포함**(들여쓰기), 이미지는 `!파일명` | 시맨틱 HTML, 이미지 `<p><img src alt></p>`, 중첩 리스트 | `text/_notion-blocks-v3-production` `{blocks:[{blockId, blockSubtree:{__version__:3, block:{…}}}]}` (자식 서브트리 포함) |

항상 함께: `text/_notion-page-source-production` `{id, table:"block", spaceId}`.

우리 앱: 블록 선택 상태에서 ⌘C 를 **처리하지 않는다**(선택 모드 키 처리는 화살표·Delete·⌘D·Escape 만,
`block-editor.tsx` ~1834-1865). 선택 시 caret 을 blur 하므로 브라우저 기본 복사도 비어 있다 → 제보 그대로.
붙여넣기 쪽은 이미 `text/_notion-blocks-*` 와 HTML 을 블록 트리로 받는다(`onPaste`).

## 4. 반영 (2026-09-09, `e2e/selection-copy.check.mjs` 로 시나리오별 검증)

| 시나리오 | 노션(측정) | 우리 앱 — 반영 전 | 반영 후 |
|---|---|---|---|
| A 블록 안 텍스트 드래그 | 텍스트 선택, `::selection` 0.28 | 텍스트 선택, 색은 브라우저 기본 | 텍스트 선택, **0.28** |
| B·C·H 블록을 넘는 텍스트 드래그 | 텍스트 선택 유지, 복사=마크다운+시맨틱 HTML | **블록 선택으로 전환**, ⌘C 무반응 | **텍스트 선택 유지**(첫 블록에 갇히지 않음), 복사=`1. …`/`<ol><li>`+내부 트리 |
| D 텍스트 → 이미지 | 블록 선택(halo) | 블록 선택 후 mouseup 의 click 이 선택을 지움 | 블록 선택 유지, 복사에 이미지 포함 |
| E 여백 마퀴 | 블록 선택, halo 실시간 | 여백은 에디터 밖이라 **텍스트 선택** | 블록 선택, halo |
| F 이미지 클릭 | 블록 선택 | 아무 일 없음 | 블록 선택, 복사=`![](url)`/`<img>` |
| halo | `rgba(35,131,226,0.14)` r4 ring 없음 | `bg-blue-100/80` + ring | **동일** |
| ⌘C 블록 선택 | md + html + `_notion-blocks-v3` | 아무 것도 안 됨 | md + html + `text/_ainmem-blocks-v1`(붙여넣기가 먼저 읽음), ⌘X = 복사+삭제 |
| 블록을 넘는 선택에 Backspace/타이핑 | 양끝 삭제 후 첫·끝 블록 병합 | 브라우저가 포커스 블록만 편집 | 병합(끝 블록에 자식 있으면 유지), ⌘Z 복원 |

구현 메모:
- **크롬은 드래그 선택을 시작한 editing host 안으로 제한**한다. 노션은 페이지 전체를 감싸는 `contenteditable`
  (`div.whenContentEditable`)로 편집 루트를 하나로 만든다. 우리는 텍스트에서 시작한 press 동안만 에디터 루트에
  `contenteditable=true` 를 주고 release 에 되돌린 뒤 leaf 에 포커스를 돌려준다(선택은 문서의 것이라 살아남음).
- `Selection.containsNode`/`toString` 은 포커스 host 로 잘린다 — 블록을 넘는 선택은 `Range` 로 다룬다.
- press 와 release 가 다른 행이면 브라우저가 공통 조상에 `click` 을 쏘고 행의 onClick 이 선택을 지우던 것을 삼킴.
- 측정 안 한 것(그래서 단정하지 않은 것): 드래그 시작 임계 픽셀, Escape 의 정확한 의미(G 불확정), 러버밴드
  시각 요소(관측상 없음). A 의 `text/html` 은 브라우저 기본(노션은 태그 없는 텍스트) — 그대로 둠.

## 5. 재는 법

- 노션: 골든셋 탭 하나에 `Input.setInterceptDrags` 켜고 마우스 이벤트로 드래그. **주의** — 페이지 로드 후 첫
  1–2회 상호작용은 하이드레이션 전에 삼켜진다(A1·warmup 실패가 그것). 준비 대기(마우스 이벤트 왕복 <300ms) 후 잴 것.
  큰 페이지에선 마우스 이벤트 1개가 ~5초 걸려 드래그 하나가 46–86초.
- 우리 앱: `app/e2e/selection-copy.measure.mjs` 가 같은 시나리오를 dev 에서 재고 JSON 을 낸다.
