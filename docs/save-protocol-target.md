# 저장 프로토콜 — 목표 정의 (노션과 같게)

기준값은 전부 `docs/notion-save-protocol.md` 의 실측이다. 이 문서는 "그 실측과 같아진 상태"가
무엇인지 빠지는 것 없이 적는다. 구현은 아래 §9 의 단계로 나눠 가되, **각 단계가 끝난 상태는 이 문서의
해당 절과 재서 차이 0 이어야 한다.** 판단이 아니라 측정으로 닫는다(`CLAUDE.md` 의 Projects 규칙과 같다).

## 0. 원칙 세 줄

1. **문서를 보내지 않는다. 바뀐 것만, 연산으로 보낸다.** 요청 크기는 편집 크기에만 비례한다.
2. **보내기 전에 로컬에 적고, 서버가 확인하면 지운다.** 실패했을 때 저장하는 것이 아니다. 확인 없이
   사라지는 편집은 없다. 24 시간 만료 같은 "포기"는 없다.
3. **같은 것을 두 번 보내도 한 번만 적용된다.** 재시도·회수·중복 전송이 안전하려면 서버가 트랜잭션 id 로
   멱등해야 한다.

## 1. 데이터 모델

### 1.1 블록 레코드

지금의 `blocks` 행이 그대로 레코드다: `id`, `pageId`, `type`, `content`, `parentBlockId`, `position`.
바뀌는 것은 **텍스트를 담는 방식**(§1.2)과 **삭제의 표현**이다.

- 삭제는 행을 지우지 않고 `alive=false` 로 표시한다(노션 `update {alive:false}`). 되살리기(undo, 회수된
  트랜잭션의 재적용)가 같은 id 로 가능해야 하기 때문이다. 읽기 경로는 `alive=true` 만 본다. 물리 삭제는
  히스토리 보존 기간 뒤 배치로 한다.
- 순서는 지금처럼 `position`(실수, 이웃의 중간값) + `parentBlockId` 로 둔다. 노션은 부모의
  `content` 배열에 `listAfter/listBefore/listRemove` 로 넣지만, 두 방식은 표현력이 같고 우리 쪽은
  `position` 갱신 하나로 끝난다. **재서 비교하는 대상은 "무엇이 저장되나"가 아니라 "몇 바이트를 언제
   보내나, 무엇이 유실되지 않나"** 이므로 여기서는 우리 표현을 유지한다.

### 1.2 텍스트 = 글자 단위 CRDT (text instance)

블록 하나의 서식 있는 텍스트를 **text instance** 하나로 둔다. 노션의 `textInstanceId` 에 해당한다.

- **item**: `{ id: [clientId, seq], originId: [clientId, seq] | "start", content: string, attrs, deleted }`.
  `id` 는 이 클라이언트가 만든 몇 번째 조각인지(`seq` 는 클라이언트별 단조 증가), `originId` 는 "이것의
  바로 왼쪽에 있던 item". 노션 실측의 `insertText.args.id / originId` 와 같은 뜻이다.
- **순서 규칙**(RGA/YATA 계열): 같은 `originId` 를 가리키는 item 이 여럿이면 `id` 의 (seq 내림차순,
  clientId 사전순)으로 결정한다. 두 클라이언트가 어떤 순서로 연산을 받아도 같은 결과가 나온다 — 이것이
  실측에서 두 탭이 같은 블록에 동시에 쳤을 때 양쪽이 `… A탭 B탭` 으로 같아진 이유다.
- **삭제는 tombstone**(`deleted=true`). 조각은 남고 렌더링에서 빠진다. `originId` 참조를 깨지 않기 위해
  물리적으로 지우지 않는다. 오래된 tombstone 정리는 서버 스냅샷 시점에 한다(§4.6).
- **서식**은 item 의 `attrs`(`b`, `i`, `u`, `s`, `code`, `a{href}`, `color`, `mention{userId}` …) 다. 서식
  변경은 `formatText` 연산(§2)으로, 범위 안 item 들을 attrs 경계에서 쪼개(split) 표시한다.
- **렌더링**: item 을 순서대로 이어 붙이며 tombstone 을 건너뛰고, attrs 가 같은 인접 조각을 합쳐 HTML 을
  만든다. 지금의 `content.html`/`content.text` 는 이 렌더링의 **캐시**로 계속 저장한다(검색·미러·MCP
  읽기가 그대로 쓰도록). 진실은 item 열이다.
- **캐럿**: DOM 오프셋 ↔ item 위치 변환. 삽입 위치의 `originId` 는 "캐럿 왼쪽 글자의 id". 캐럿이
  블록 처음이면 `"start"`.

### 1.3 텍스트가 아닌 필드

`type`, `position`, `parentBlockId`, `alive`, `content` 의 텍스트 아닌 부분(체크 여부, 접힘 여부, 이미지
URL, 표 데이터 …)은 **마지막 쓰기 승**(last-writer-wins)이다. 노션도 `update` 는 그렇게 처리한다
(`last_edited_time` 을 같이 보내는 것이 그 증거). 표 셀 텍스트도 각 셀을 text instance 로 두어 §1.2 를
따른다.

## 2. 연산 카탈로그

연산 = `{ command, pointer: { table: "block" | "page", id }, path: string[], args }`. 서버는 각 연산을
아래 의미대로, **트랜잭션 단위로 원자적으로** 적용한다.

| command | pointer.path | args | 의미 | 노션 실측 대응 |
|---|---|---|---|---|
| `set` | `[]` | 레코드 전체 | 블록 생성(없으면 만들고, 있으면 전체 교체) | Enter 의 `set` |
| `update` | `[]` 또는 필드 경로 | 부분 필드 | 스칼라 필드 LWW 갱신. `alive:false` 가 삭제 | `update` |
| `insertText` | `["content","text"]` 등 instance 경로 | `{ instanceId, id, originId, content, attrs }` | item 삽입 | `insertText` |
| `deleteText` | 동일 | `{ instanceId, idRanges: [[id, length]] }` | 범위 tombstone | `deleteText` |
| `formatText` | 동일 | `{ instanceId, idRanges, attrs }` | 범위 서식 | (노션은 `update` + 서식 경로) |
| `splitText` | 동일 | `{ instanceId, id }` | `id` 부터 뒤를 잘라 새 instance 로 | `splitText` |
| `moveTextSlice` | 동일 | `{ instanceId, fromId, targetBlockId, targetInstanceId, targetOriginId }` | 잘린 조각 열을 다른 블록 끝/특정 위치로 | `moveTextSlice` |

UI 동작 → 트랜잭션(연산 순서)은 실측 표(`notion-save-protocol.md` §1)를 그대로 따른다.
- 글자 입력: `insertText` · `update last_edited`.
- Enter: `set`(새 블록) · `update`(부모/위치) · `update last_edited`(새 블록·페이지).
  캐럿이 중간이면 `splitText` · `moveTextSlice` 가 앞선다.
- Backspace(글자): `deleteText` · `update last_edited`.
- Backspace(블록 처음): `splitText` · `moveTextSlice`(앞 블록으로) · `update {alive:false}` · `update last_edited`.
- 드래그 이동: `update {parentBlockId, position}`.
- 타입 변환: `update {type}` (+ 필요한 `content` 필드).
- 붙여넣기(여러 블록): 블록마다 `set`, 한 트랜잭션.

`last_edited` 는 우리 스키마의 `updatedAt` 과 페이지 `updatedAt` 이다. 서버가 적용 시각으로 채운다.

## 3. 트랜잭션

```
{ id: uuid, pageId, userId, timestamp, debug: { userAction, clientCommitTimeMs }, operations: Op[] }
```

- **사용자 동작 하나 = 트랜잭션 하나.** `debug.userAction` 은 어떤 핸들러였는지(`Text.handleMutation`,
  `Text.handleEnter`, `textBackspaceAtBeginning` …). 디버깅용이고 의미는 없다.
- 서버는 트랜잭션을 **통째로 받거나 통째로 거절**한다. 연산 하나가 실패하면 그 트랜잭션의 나머지도
  적용하지 않는다.
- **멱등**: `id` 를 본 적 있으면 다시 적용하지 않고 성공으로 답한다.
- 순서: 한 세션이 만든 트랜잭션은 만든 순서대로 보내고, 서버도 그 순서로 적용한다. 다른 세션 것과의
  순서는 보장하지 않아도 된다 — CRDT(텍스트)와 LWW(스칼라)가 그 전제로 설계됐다.

## 4. 서버

### 4.1 엔드포인트

`POST /api/pages/:pageId/transactions` — 본문 `{ requestId, transactions: Transaction[] }`, 응답 `{}`
(200). 거절은 `{ rejected: [{ id, reason }] }` 로 200 에 담는다(전송 자체는 성공이고, 클라이언트는 그
트랜잭션을 큐에서 빼고 사용자에게 알린다). 인증·권한은 지금 `PUT /blocks` 와 같다(세션 또는 공유 토큰의
edit 권한, `restricted` 페이지의 `pageMembers`).

### 4.2 적용 절차 (트랜잭션마다, DB 트랜잭션 하나 안에서)

1. `transactions` 테이블에 `id` 가 있으면 건너뜀(성공).
2. 연산을 순서대로 적용. 텍스트 연산은 instance 를 읽어 item 열에 병합하고 `content.text/html` 캐시를
   다시 만든다. `set`/`update` 는 행을 upsert.
3. 관련 블록과 페이지의 `updatedAt` 갱신.
4. `transactions` 에 `(id, pageId, userId, appliedAt, operations)` 기록 — 멱등 판정과 감사용.
5. 커밋. 실패하면 롤백하고 `rejected` 에 넣는다.

### 4.3 검증 (노션의 before/after)

- 텍스트 연산: `originId` 가 가리키는 item 이 instance 에 없으면 거절(순서가 어긋난 재전송). `deleteText`
  의 범위가 없는 id 를 가리키면 그 부분만 무시.
- `set`/`update`: 대상 블록이 다른 페이지 것이면 거절. 이미 `alive=false` 인 블록에 대한 `update` 는 적용
  (되살리기 포함).
- 권한은 요청 단위로 한 번.

### 4.4 팬아웃 (실시간)

지금은 `publish({type:"blocks"})` 뒤 수신자가 전체 블록을 다시 GET 한다. 목표는 **적용된 트랜잭션
자체를 SSE 로 보내고** 수신자가 같은 연산을 로컬 상태에 적용하는 것(`type:"transactions"`, 본문 포함).
자기 것은 `clientId` 로 걸러낸다. 전체 GET 은 SSE 재연결 직후 한 번만.

### 4.5 부수 효과

멘션 알림(`notifyMentions`), 스냅샷(`maybeSnapshot`), md 미러(`scheduleMirror`)는 지금 `PUT /blocks`
에서 하는 것을 그대로 트랜잭션 적용 뒤에 한다.

### 4.6 스냅샷과 tombstone 정리

`page_snapshots` 는 렌더된 블록(캐시)을 저장하므로 바뀌지 않는다. 스냅샷을 찍는 시점에, 그 페이지의
모든 세션이 확인한(=큐가 빈) 것이 보장되지 않으므로 tombstone 은 **서버 기준 30 일** 지난 것만 지운다.

### 4.7 기존 쓰기 경로

`PUT /blocks`, `POST /blocks`, MCP(`relational-memory-mcp`), 노션 붙여넣기, 복제, 템플릿 등 서버·스크립트
쪽 쓰기는 전부 **서버 안에서 트랜잭션으로 변환**해 같은 적용 절차를 탄다. 에디터가 아닌 쓰기가 item 열을
우회해 `content.text` 만 바꾸는 순간 CRDT 가 깨지므로, 이것이 제일 중요한 이행 조건이다.

## 5. 클라이언트 — 트랜잭션 큐

### 5.1 저장소: IndexedDB `TransactionStore`

- `Transaction` (keyPath `index` 자동 증가; 인덱스 `byId`, `bySessionId`, `byTimestamp`, `byUserId`):
  레코드 = 트랜잭션 그대로 + `sessionId`.
- `Session` (keyPath `index`; 인덱스 `bySessionId`, `byOwnerSessionId`, `byUpdatedAt`):
  `{ sessionId, ownerSessionId, updatedAt }`. 탭 하나 = 세션 하나. `updatedAt` 은 **심장박동**(5 초마다).

### 5.2 생명주기

1. `mutate` 가 트랜잭션을 만든다 → **먼저** `Transaction` 에 넣고 **쓰기 완료를 기다린다**(실측: add 2.6ms →
   complete 3.1ms → fetch 4.7ms) → 화면 상태에 적용한다 → 큐에 알린다. 쓰기가 끝나기 전에 보내지 않는다.
2. 큐는 **한 번에 하나의 요청**만 보낸다. 조용할 때 첫 트랜잭션은 **즉시**(≤ 10ms). 응답이 오면
   **500ms 뒤**에 그 사이 쌓인 것을 **한 요청에 전부** 싣는다.
3. 200 이 오면 실린 트랜잭션을 `Transaction` 에서 지운다. `rejected` 는 지우고 사용자에게 알린다.
4. 실패(네트워크·5xx·브라우저 거부)는 **5 초 뒤 같은 트랜잭션 id 로 같은 본문**을 다시 보낸다. 지수
   백오프 없음(실측 5.0 초 고정).
5. `keepalive` 는 쓰지 않는다. 탭이 닫히면 진행 중 요청은 끊기고, 그 트랜잭션은 큐에 남는다.

### 5.3 세션과 고아 회수

- **대기 트랜잭션이 있을 때만** `Session` 에 자기 레코드를 두고 **2.5 초**마다 `updatedAt` 을 갱신한다(실측
  2,505 ms). 큐가 비면 행을 지운다 — 조용한 탭은 IndexedDB 를 건드리지 않는다.
- 시작 1 초 뒤, 그리고 2.5 초마다, `updatedAt` 이 **12.5 초**(5 박동) 넘게 멈춘 세션을 찾아 그 세션의
  트랜잭션을 자기 세션으로 옮겨(`ownerSessionId` 갱신) 보낸다. 실측에서 살아 있는 탭이 죽은 탭의 것을
  회수하기까지 닫힌 시각 기준 13.6~13.7 초였고, 이 값들로 12.5~15 초에 일어난다. 새 탭이 열릴 때만이 아니라
  **살아 있는 아무 탭**이 한다.
- 같은 오리진의 여러 탭이 동시에 회수하지 않도록 `ownerSessionId` 갱신을 IndexedDB 트랜잭션 안에서
  조건부(아직 원래 주인이면)로 한다.

### 5.4 화면 표시

- 저장은 조용하다(`data-save-state` 는 테스트용으로 유지: `idle | saving | saved | offline | error`).
- 큐가 비어 있지 않고 마지막 시도가 실패면 우상단 배지. 네트워크 실패는 `오프라인`, 서버 거절/5xx 는
  `저장 실패`. 둘 다 "변경 내용은 이 브라우저에 보관됨" 을 덧붙인다. 성공하면 배지가 사라진다.
- 큐에 남은 것이 있으면(`beforeunload`) 브라우저 기본 확인창을 띄우지 **않는다** — 노션도 띄우지 않고
  다음 세션이 회수한다.

### 5.5 원격 수신

SSE 로 온 트랜잭션을 로컬 상태에 적용한다. 자기 세션의 미확인 트랜잭션과 겹치는 블록도 CRDT/LWW
규칙으로 그냥 합친다 — 지금의 "dirty 면 미룬다"는 사라진다. 캐럿이 있는 블록도 예외가 아니다(item
기준으로 캐럿을 다시 놓는다).

### 5.6 undo/redo

로컬 히스토리는 **역연산**으로 만든다: `insertText` ↔ `deleteText`, `update` ↔ 이전 값 `update`,
`set` ↔ `alive:false`. undo 도 트랜잭션이다(`debug.userAction: "undo"`).

## 6. 이행(마이그레이션)

1. 스키마: `blocks.alive boolean default true`, `blocks.content.textItems`(instance 열), `transactions`
   테이블. `pnpm db:check` 와 `/api/health` 가 모자란 것을 알려주는 구조를 유지한다(`schema-drift.ts` 는
   `schema.ts` 의 테이블을 전부 자동으로 본다). **1 단계는 `transactions` 테이블만 더한다** — dev 에는
   2026-09-08 에 밀었고, prod 는 배포 때 `pnpm db:push` 를 사람이 한 번 해야 한다(`deployment.md` §3.6).
   안 하면 부팅 로그와 `/api/health`(503) 가 그 테이블이 없다고 말하고, 에디터의 저장은 전부 5 초 재시도에
   걸린 채 IndexedDB 에 쌓인다(유실은 없다).
2. 기존 텍스트 → item 하나로 초기화: `{ id: ["migration", 1], originId: "start", content: text, attrs }`.
   노션 실측의 `prevItems[0]`(`originId:"start", id:[…,1], length:14, content:"프로브 …"`)와 같은 형태다.
   서식은 `html` 을 파싱해 attrs 경계로 쪼갠다. 마이그레이션은 서버가 **읽을 때 게으르게**(instance 가
   없으면 만들어 저장) 해서 한 번에 밀지 않는다.
3. 에디터가 아닌 쓰기(§4.7)를 트랜잭션으로 바꾼 뒤에만 에디터를 item 기반으로 전환한다. 순서가 반대면
   캐시만 바꾸는 쓰기가 item 을 낡게 만든다.
4. 옛 `localStorage` 초안(`draft-*`, `draft-archive-*`)은 발견하면 `update {content}` 트랜잭션으로 큐에 넣고
   지운다.

## 7. 잰다 — 완료 판정

각 항목은 `app/e2e/*.check.mjs` 로 dev 에서 재서 exit 0 이어야 한다. 숫자는 실측값이다.

| 항목 | 기준 |
|---|---|
| 요청 크기 | 227 블록·65KB 페이지에서 글자 하나 입력 → 요청 ≤ 2KB |
| 지연 | 조용할 때 첫 입력 → 요청 ≤ 50ms (IndexedDB 쓰기 완료 뒤에 보내는 조건에서, 리렌더가 가벼운 페이지 기준); 응답 후 다음 요청 450~600ms; 동시 진행 1. 227 블록 페이지에서는 리렌더가 그 사이에 끼어 2026-09-08 기준 477ms — 이 값은 타이핑 지연(성능) 작업의 기준이다 |
| 배치 | 응답 대기 중 5 타 → 다음 요청에 트랜잭션 5 개 |
| 로컬 보관 | 오프라인 5 타 → `Transaction` 5 건; 온라인 복귀 → 0 건 |
| 재시도 | 오프라인에서 5.0±0.5 초 간격, 같은 id |
| 멱등 | 같은 요청 2 회 → 블록 1 개 |
| 탭 닫기 | 입력 후 10ms 에 닫기 → 새 탭 열고 ≤ 15 초 안에 서버 반영 |
| 동시 편집 | 두 탭이 같은 블록에 " A", " B" → 양쪽 최종 텍스트 동일, 둘 다 포함 |
| 유실 없음 | 위 모든 시나리오에서 서버 최종 상태가 입력 전부를 포함 |
| 배지 | 오프라인 중 `오프라인` 표시, 복귀 후 사라짐 |

## 8. 하지 않는 것

- `keepalive`/`sendBeacon` — 노션이 안 쓰고, 큐가 그 역할을 대신한다.
- 24 시간 초안 만료, 실패 시에만 저장 — 사라진다.
- 문서 전체 PUT — 에디터 경로에서 사라진다. `PUT /blocks` 는 스크립트·MCP 호환용으로만 남고 서버 안에서
  트랜잭션으로 변환된다.

## 9. 단계

| 단계 | 내용 | 끝났다는 기준(§7) |
|---|---|---|
| **1 (지금)** | 블록 단위 연산(`set`/`update`/`alive`), IndexedDB 큐(§5 전부), 멱등 서버(§4.1·4.2·4.5, 텍스트는 `update {content}` LWW), 옛 초안 회수 | 요청 크기·지연·배치·로컬 보관·재시도·멱등·탭 닫기·배지 |
| 2 | 서버 안 트랜잭션 변환(§4.7), `alive` 소프트 삭제, SSE 로 트랜잭션 팬아웃(§4.4) | 원격 수신이 전체 GET 없이 반영 |
| 3 | 텍스트 CRDT(§1.2·§2 텍스트 연산·§5.5·§5.6·§6.2) | 동시 편집 병합 |

1 단계가 끝나면 이번 사고의 원인 세 가지(전체 전송, 문자 수 판정, 24h 삭제)는 모두 없어진다. 3 단계까지
가면 두 사람이 같은 블록을 동시에 고칠 때도 노션과 같다.
