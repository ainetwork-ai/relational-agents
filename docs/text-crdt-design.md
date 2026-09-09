# 3단계 설계 — 글자 단위 텍스트 CRDT

`docs/save-protocol-target.md` §1.2·§2·§5.5·§5.6·§6.2 를 구현 수준으로 푼 것. 기준은
`docs/notion-save-protocol.md` 의 실측이다: 노션은 블록 안 텍스트를 글자 단위 연산으로 보내고
(`insertText`/`deleteText`/`splitText`/`moveTextSlice`, `id:[clientId,seq]`, `originId`), 두 탭이 같은
블록에 동시에 쳐도 양쪽이 같은 결과로 합쳐진다. 1·2 단계가 끝난 지금 남은 차이는 이것 하나다.

## 0. 목표와 비목표

- 목표: 두 사람이 같은 블록을 동시에 고쳐도 서버·양쪽 화면이 같은 텍스트로 수렴한다. 자기 캐럿은
  원격 삽입에 밀리지 않는다. 그 외 저장 동작(큐·재시도·팬아웃)은 2 단계 그대로다.
- 비목표: 커서 위치 공유(이미 별도 `cursor` 이벤트), 블록 순서의 CRDT(`position` LWW 유지 — 노션도
  `listAfter` 는 서버 검증형이고 실측상 문제가 없었다), 표 셀 이동 등 구조 편집의 재작성.

## 1. 데이터 모델

```ts
type ItemId = [clientId: string, seq: number];        // seq 는 Lamport 시계: 내가 본 최대 seq + 1
interface TextItem {
  id: ItemId;
  origin: ItemId | "start";   // 삽입 당시 바로 왼쪽에 있던 item
  text: string;               // 1 글자 이상 — 연속 입력은 클라이언트·서버가 run 으로 합친다(§6)
  attrs?: Attrs;              // { b, i, u, s, code, a: { href }, color, mention: { userId } }
  deleted?: true;             // tombstone
}
interface TextInstance { items: TextItem[] }          // 정렬된 상태로 저장
```

- 블록 `content` 에 `items: TextItem[]` 가 추가된다. `content.text` 와 `content.html` 은 **렌더 캐시**로
  계속 저장한다 — 검색·미러·export·MCP 읽기·히스토리 스냅샷은 전부 캐시만 읽으므로 바뀌지 않는다.
- 표 블록은 셀마다 instance: `content.table.cellItems[row][col]`. 캐시는 지금의 `cells[row][col]`.
- 그 외 필드(`type`, `position`, `parentBlockId`, `checked`, `expanded`, 이미지 URL …)는 LWW 그대로.

### 1.1 순서 규칙 (RGA, Lamport seq)

`seq` 는 클라이언트별 카운터가 아니라 **Lamport 시계**다: 새 item 은 "그 instance 에서 지금까지 본 가장 큰
seq + 1" 을 받는다. 그래야 방금 친 글자가 origin 바로 뒤에 놓인다(카운터였다면 오래된 이웃보다 작은 seq 라
run 의 끝으로 밀린다 — `scripts/text-crdt.check.mts` 의 "삭제된 글자 뒤 삽입" 이 그 경우다).

item 은 origin 이 가리키는 item 의 **바로 오른쪽**에 들어간다. 같은 origin 을 가리키는 item 이 여럿이면
`seq` 내림차순, 같으면 `clientId` 사전순 — 어떤 순서로 연산이 도착해도 결과가 같다. 정렬은 "origin 을
찾아 그 뒤에서 규칙에 맞는 자리까지 오른쪽으로 이동" 이라 삽입 비용은 O(n)이고 블록 하나 안에서만
일어난다(문단 하나 수천 글자가 상한).

예: 두 탭이 `"AB"` 의 B 뒤에 동시에 각각 `x`(탭1, seq 5)와 `y`(탭2, seq 3)를 넣으면 origin 이 둘 다 B.
규칙에 따라 `x`(seq 5) 가 앞 → 양쪽 모두 `"ABxy"`. 실측(`… A탭 B탭`)과 같은 성질이다.

### 1.2 삭제 = tombstone

`deleted:true` 로 표시하고 남긴다(누군가의 origin 일 수 있다). 렌더에서 빠진다. 서버가 캐시를 다시 만들
때, **모든 세션이 확인했다고 볼 수 있는 시점**이 없으므로 30 일 지난 tombstone 만 지운다(`updatedAt`
기준). 지운 tombstone 을 origin 으로 하는 늦은 삽입은 "origin 없음" 으로 거절되고(§5.3) 클라이언트가
자기 상태로 다시 만든다.

## 2. 연산

`Operation` 유니온에 넷을 더한다. `pointer` 는 블록, `path` 가 instance 를 가리킨다
(`["content","items"]` 또는 `["content","table","cellItems",r,c]`).

| command | args | 의미 |
|---|---|---|
| `insertText` | `{ items: TextItem[] }` | item 들을 병합 삽입. 한 연산에 여러 item(붙여넣기 한 조각 등) |
| `deleteText` | `{ ranges: [ItemId, number][] }` | id 부터 length 개 item 을 tombstone |
| `formatText` | `{ ranges: [ItemId, number][], attrs: Partial<Attrs>, remove?: (keyof Attrs)[] }` | 범위 attrs 병합/제거. 범위 경계에 걸친 item 은 서버·클라이언트가 같은 규칙으로 쪼갠다(§6) |
| `moveTextSlice` | `{ from: ItemId, toBlock: string, toPath, toOrigin: ItemId \| "start" }` | `from` 부터 끝까지의 item 열을 다른 instance 로 옮긴다(id 유지, origin 만 첫 item 이 `toOrigin` 으로) |

노션의 `splitText` 는 `moveTextSlice` 로 대신한다(우리 블록 생성이 `set` 이라 "잘라서 새 블록으로" 는
`set` + `moveTextSlice` 두 연산으로 한 트랜잭션이 된다).

②에서 구현하며 확정된 세부(`lib/transactions/types.ts`, `lib/text-crdt/ops.ts`):
- 모든 텍스트 연산 `args` 에 `instance`(연산을 만든 instance id)가 들어간다. 서버의 instance 와 다르면 트랜잭션
  거절. **instance 가 아직 없는 블록은 연산이 들고 온 id 를 채택**한다 — 양쪽이 같은 html 에서 같은 items
  (`["m",1..n]`)를 만들기 때문에 좌표가 일치한다. 게으른 마이그레이션은 이렇게 "첫 연산이 도착할 때" 일어난다.
- `formatText` 는 attrs 객체가 아니라 **태그 스택** `tags: string[]`(sanitizer 가 내는 여는 태그, 바깥부터)을 범위에
  덮어쓴다. ①의 item 모델이 서식을 태그 스택으로 들고 있어 그대로 맞췄다. `[]` 는 서식 해제.
- `moveTextSlice` 에서 옮겨지는 조각 중 origin 이 **잘린 곳 왼쫀에 남은** 글자를 가리키는 item(동시 삽입이 그 자리에
  걸린 경우)은 바로 앞 조각의 마지막 글자로 다시 건다. 조각 안에서만 결정되므로 모든 복제본이 같다.
- 캐시 재생성은 `mergeRuns` 뒤 `renderHtml`/`renderText`. 표 셀은 `cells[r][c]`(text)와 `html[r][c]` 둘 다.

UI → 트랜잭션:
- 글자 입력: `insertText`(item 1 개씩 보낸다 — 노션도 글자마다 연산). 자기 상태에서는 §6 규칙으로 바로 합친다.
- Enter(중간): `set`(새 블록) · `moveTextSlice`(캐럿 이후 → 새 블록 `"start"`) · `update position`.
- Backspace(블록 처음): `moveTextSlice`(이 블록 전부 → 앞 블록 끝) · `update {alive:false}`.
- 서식 단축·툴바: `formatText`. 마크다운 자동서식(`**a**` → 굵게)은 `deleteText`(마커) + `formatText`.
- 붙여넣기(한 줄): `insertText`(item 여러 개, 서식 경계마다). 여러 블록: 블록마다 `set`(items 포함).
- 표 셀 입력: 같은 연산, `path` 만 셀.

기존 `update {content}` 로 텍스트를 바꾸는 것은 **에디터에서는 사라진다**. 서버 쪽 쓰기(PUT /blocks,
MCP, 히스토리 복원)에서 오는 `update {content:{text,html}}` / `set` 은 서버가 §6 규칙으로 items 를
다시 만든다.

## 3. 클라이언트 — 에디터

### 3.1 상태
`EBlock.content.items` 를 진실로 둔다. 렌더는 items → (tombstone 제외, attrs 같은 인접 조각 합침) →
HTML. 지금의 `sanitizeInline` 결과와 같은 HTML 이 나오도록 렌더러를 맞춘다(기존 e2e 가 그걸 잰다).

### 3.2 입력 → 연산 (실측에 맞춤: uncontrolled, mutation 기반)

노션은 `beforeinput` 을 막지 않는다(`defaultPrevented:false`). 브라우저가 DOM 을 먼저 바꾸고, 노션이
바뀐 결과를 읽어 연산을 만든다(트랜잭션의 `userAction` 이 `Text.handleMutation`). 우리도 같게 한다 —
지금의 `onInput`(DOM 을 읽는 방식)을 **유지**하되, "블록 텍스트를 통째로 저장" 대신 **이전 텍스트와 새
텍스트의 차이(한 곳의 삽입/삭제 구간)를 계산해 연산으로 바꾼다.**

| 상황 | 연산 |
|---|---|
| 글자 입력·붙여넣기(한 줄) | 차이 구간의 왼쪽 글자 id 를 origin 으로 `insertText` |
| 삭제 | 차이 구간을 `deleteText` |
| 교체(선택 후 입력, 자동 교정) | `deleteText` + `insertText` |
| Enter | `set`(새 블록) + `moveTextSlice` + `update position` |
| Backspace(블록 처음) | `moveTextSlice` + `update {alive:false}` |
| 서식 단축·툴바 | `formatText` |
| IME 조합 | **조합 갱신마다** 연산을 만든다(노션 실측: ㅎ → `insertText:ㅎ`, 하 → `deleteText`+`insertText:하`). 확정을 기다리지 않는다 |

차이 계산은 공통 접두·접미를 떼는 O(n) 이고 블록 하나 안에서만 한다. 원격 변경이 같은 블록에 끼어들면
"이전 텍스트" 가 원격 반영 뒤의 것이어야 하므로, 원격 병합 → 렌더 → 그 결과를 다음 차이 계산의 기준으로
삼는다(§3.5).

### 3.3 캐럿
캐럿을 DOM 오프셋이 아니라 **item 좌표**(`{ after: ItemId | "start" }`)로 들고 다닌다. 렌더 뒤 item →
DOM 오프셋으로 되돌린다(`lib/editor/caret.ts` 확장). 원격 삽입이 캐럿 왼쪽에 들어와도 캐럿은 같은
item 뒤에 남는다 — 이것이 지금 "캐럿 블록은 원격 변경을 미룬다" 규칙을 없앨 수 있는 근거다.

### 3.4 undo/redo
스냅샷 diff(`restoreSnapshot`)를 **역연산**으로 바꾼다. 트랜잭션마다 inverse 를 함께 만들어 둔다:
`insertText` ↔ `deleteText`(같은 id 들), `deleteText` ↔ "되살리기"(`insertText` 로 같은 id·origin 재삽입 —
서버는 tombstone 해제로 처리), `formatText` ↔ 이전 attrs 로 `formatText`, `set` ↔ `update {alive:false}`,
`update` ↔ 이전 값 `update`. undo 도 보통 트랜잭션이다(`debug.userAction:"undo"`).

### 3.5 원격 병합
SSE 로 온 텍스트 연산을 자기 items 에 병합하고 다시 그린다. 캐럿은 §3.3 으로 유지. 2 단계의
"캐럿 블록 미루기" 는 삭제.

### 3.6 성능 (6 번 항목 포함)
- `BlockRow` 를 `memo` 로 감싸고 `blocks` 배열 대신 블록 하나를 props 로 받게 해서, 키 입력이 **그 블록만**
  다시 그리게 한다. 목표: 229 블록에서 입력 → IndexedDB 완료 10ms 안(노션 실측 2~9ms).
- 렌더러는 items 가 바뀐 블록만 HTML 을 다시 만든다.

## 4. 클라이언트 — 큐
바뀌지 않는다. 트랜잭션 크기만 작아진다(item 1 개 ≈ 100 B).

## 5. 서버

### 5.1 적용기
`applyTransactions` 에 텍스트 연산 적용기를 더한다: instance 를 읽고(없으면 §7 게으른 변환) items 에
병합 → 캐시(`text`/`html`, 표는 `cells`) 재생성 → 저장. 한 트랜잭션 안의 여러 연산은 지금처럼 DB
트랜잭션 하나.

### 5.2 멱등
지금 그대로(트랜잭션 id). 텍스트 연산은 그 자체로도 멱등이다(같은 id 의 item 재삽입은 무시).

### 5.3 검증 (before/after)
- `insertText`: origin 이 instance 에 없으면(tombstone GC 뒤의 늦은 삽입, 혹은 순서가 어긋난 재전송) **그
  트랜잭션 거절** → 4xx `rejectedIds`. 클라이언트는 그 item 들을 현재 상태 기준으로 다시 만들어 보낸다.
- `deleteText`/`formatText`: 없는 id 는 무시(이미 GC 된 tombstone).
- `moveTextSlice`: 대상 블록이 다른 페이지면 거절.

### 5.4 팬아웃
2 단계 그대로(`type:"transactions"`).

## 6. run 합치기 — 클라이언트와 서버 양쪽

**같은 사람이 연속 seq 로, 같은 attrs 로, 서로 origin 이 이어지는** 살아 있는 item 들은 하나로 합친다(id 는
첫 item 것, `text` 를 이어 붙임). 실측: 글자마다 보낸 13 개 조각을 클라이언트가 다음 연산의 `prevItems`
에서 `id:[…,1], length:13` 한 조각으로 들고 있었다 — 합치기는 **클라이언트가 자기 상태에서 즉시**, 서버는
캐시 재생성 때 같은 규칙으로 한다. 합친 item 안의 글자를 가리키는 origin 은 `[clientId, seq+offset]` 로
복원한다(seq 연속 조건). tombstone 도 같은 규칙으로 합친다. `formatText` 가 run 중간에 걸치면 경계에서
쪼갠다(쪼갠 조각 id 는 `[clientId, seq+offset]` 로 결정적).

## 7. 마이그레이션

- 서버가 instance 를 **처음 필요로 할 때** 만든다: `items` 가 없으면 `html` 을 태그 경계에서 쪼개
  `[{ id: ["migration", 1..n], origin: 이전 item, text, attrs }]` 로 저장한다. `html` 이 없으면 `text` 로 item
  하나. 노션 실측의 `prevItems[0]`(`originId:"start"`, `id:[…,1]`)과 같은 형태다. 한 번에 밀지 않는다.
- 서버 쪽 쓰기(PUT /blocks, MCP, 복원)의 `set`/`update {content}` 는 **새 instance**(`textInstance` 교체, html 로
  items 재구성)가 된다 — 노션 실측과 같다(API 식 교체 뒤 새 `textInstanceId`, `prevItems:[start]`). 이전
  instance 를 향한 늦은 연산은 instance 불일치로 거절되고 클라이언트가 다시 만든다. 이 변환이 에디터 전환보다
  **먼저** 들어가야 캐시만 바꾸는 쓰기가 items 를 낡게 만들지 않는다. (①에서 구현: `lib/text-crdt/content.ts`
  `withTextInstance`, `applyTransactions` 의 `normalizeContent` 가 모든 content 쓰기에 적용.)
- **정규형.** `render(parse(h))` 는 바이트 동일이 아니라 DOM 동일을 목표로 한다: 저장된 html 에는 `&quot;` 와 `"`
  가 섞여 있고 `</b><b>` 처럼 같은 태그가 붙은 것도 있어 한 표기로 모은다. dev 7,150 건·prod 4,643 건 전부
  글자·태그 열 보존 + 멱등을 확인했고, 그중 58/53 건이 표기만 바뀐다.
- 옛 클라이언트(`update {content}` 를 보내는 이전 빌드 탭)가 남아 있을 수 있으니, 그 형태도 같은 변환으로
  받는다. 배포 뒤 열려 있던 탭은 새 코드가 아니어도 데이터를 깨지 않는다.

## 8. 검증 — 완료 기준 (§7 에 추가)

| 항목 | 기준 |
|---|---|
| 동시 편집 | 두 탭이 같은 블록 끝에 " A", " B" 를 동시에 → 서버·양쪽 화면 텍스트 동일, 둘 다 포함 |
| 캐럿 유지 | 탭 B 가 캐럿 앞에 삽입해도 탭 A 의 캐럿은 같은 글자 뒤 |
| 삭제 병합 | 한쪽이 지운 범위를 다른 쪽이 고쳐도 수렴 |
| IME | 한글 조합 갱신마다 연산(노션과 같음), 조합 중 원격 삽입이 와도 조합이 깨지지 않음, 확정 뒤 서버 텍스트가 화면과 동일 |
| 크기 | 글자 하나 요청 ≤ 1.2KB(item 1 개) |
| 성능 | 229 블록에서 입력 → IndexedDB 완료 ≤ 10ms |
| 회귀 | `block-spacing`(551)·`plus-menu`·`ime-enter`·`notion-paste`·`table-cellnav`·`table-grip` 전부 통과 |
| 캐시 | 검색·export·미러·MCP 읽기 결과가 전환 전과 동일 |

## 9. 순서

1. **서버 변환 + 게으른 마이그레이션 + 캐시 재생성**(§5.1 캐시, §6, §7). 에디터 무변경. 기존 검사 전부 통과.
2. **텍스트 연산 적용기 + 검증**(§2, §5.3). API 단위 검사(두 클라이언트 id 로 동시 삽입 → 수렴).
3. **에디터**(§3.1~3.5). 회귀 검사 전부 + 동시 편집·캐럿·IME 검사.
4. **성능**(§3.6). 10ms 기준.

각 단계마다 커밋·dev 실측·배포. 1 은 스키마 변경이 없다(jsonb 안).

## 10. 결정 — 노션 실측으로 닫힘 (`docs/notion-save-protocol.md` §4b)

| 질문 | 노션 | 우리 결정 |
|---|---|---|
| 서버 쪽 전체 교체(`update {content}`)가 CRDT 이력을 끊어도 되는가 | `set properties.title` 뒤 새 `textInstanceId`, `prevItems:[start]` — 끊는다 | 같게. 새 instance 로 시작(§7) |
| 삭제된 origin 을 가리키는 늦은 삽입 | 200, 그 자리에 놓임(tombstone 보존) | 같게. tombstone 보존 기간은 노션 값을 잴 수 없어 **30 일**은 우리 선택 |
| 입력 처리 | uncontrolled, DOM 변경을 읽어 연산 생성, IME 조합 갱신마다 연산 | 같게(§3.2). controlled 재작성은 하지 않는다 — 위험이 크게 줄었다 |
| 렌더 범위 | 키 입력 하나에 블록 1 개만 다시 그림 | §3.6 을 3 단계에 포함해 같게 |
| 연속 입력 합치기 | 클라이언트도 합침 | 양쪽 모두(§6) |
