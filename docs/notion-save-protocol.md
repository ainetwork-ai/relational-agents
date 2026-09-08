# 노션의 저장 프로토콜 — 실측 (2026-09-08)

우리 에디터의 자동저장을 노션과 같게 만들기 위한 기준값. 전부 노션 스크래치 페이지
(`app.notion.com/p/comcom/3c8d8655…`, 사람이 지정)에 골든셋 크롬으로 붙어 직접 잰 것이다.
잰 스크립트는 `scratchpad/notion-save-probe.mjs`, `…probe2.mjs`, `…probe3.mjs`,
원 데이터는 그 옆의 `*.out.json` / `*.idb.json`. 프로브가 만든 블록은 끝에 지웠다(페이지 블록 수 2 → 2).

## 1. 무엇을 보내나 — 문서가 아니라 연산

- 엔드포인트: `POST /api/v3/saveTransactionsFanout`, 본문 `{ requestId, transactions[] }`.
  응답은 항상 `{}`(200). 결과를 돌려주지 않는다 — 트랜잭션 id 로 멱등하게 처리한다고 봐야 한다.
- 트랜잭션: `{ id, spaceId, debug: { userAction, clientCommitTimeMs }, operations[] }`.
  사용자 동작 하나 = 트랜잭션 하나 (`Text.handleMutation`, `Text.handleEnter`,
  `textBackspaceActions.textBackspaceAtBeginning` …).
- 연산: `{ command, pointer: { table, id, spaceId }, path, args }`. **레코드 하나의 일부만 바꾼다.**

| 동작 | 연산 (순서대로) |
|---|---|
| 글자 하나 입력 | `insertText`(block, 글자 1개) · `update`(block, last_edited_*) |
| Enter (새 블록) | `set`(새 block 전체) · `update`(parent_id/alive) · `listAfter`(부모 `["content"]`, after=이전 블록) · `update`(last_edited_*) · 첫 번째는 부모 페이지에도 `update`(last_edited_*) |
| Backspace (글자) | `deleteText`(idRanges) · `update`(last_edited_*) |
| Backspace (빈 블록 앞) | `splitText` · `moveTextSlice`(앞 블록으로) · `update`(alive:false) · `listRemove`(부모 `["content"]`) · `update`(last_edited_*) |

텍스트는 블록 안에서 **글자 단위 CRDT**다. `insertText.args = { textInstanceId, id: [clientId, seq],
originId: [clientId, seq] | "start", content, prevItems }`, `deleteText.args.idRanges`. 두 탭이 같은
블록에 동시에 " A탭", " B탭" 을 넣었을 때 두 요청 모두 200, 양쪽 최종 텍스트가 `… A탭 B탭` 으로
같았다 — 충돌이 아니라 병합이다.

크기: 글자 하나 요청 ≈ 1.0KB, Enter ≈ 1.7KB. **문서 크기와 무관하다.**

## 2. 언제 보내나

| 상황 | 측정 |
|---|---|
| 조용할 때 첫 입력 | 3~11ms 뒤 즉시 (한 번은 241ms) |
| 응답이 온 뒤 다음 전송 | 응답 후 **≈500ms**(501·507·509·510·511) 에 그 사이 쌓인 트랜잭션을 **한 요청에** |
| 동시 진행 | 항상 **1개**. 진행 중이면 큐에 쌓고 기다린다 |
| 서버 응답 시간 | 224~616ms |
| 오프라인 재시도 | **5.0초 간격**(5035·5012), **같은 트랜잭션 id 로 같은 본문**을 다시 보낸다 |
| 오프라인 표시 | 화면에 "오프라인" 텍스트가 뜬다 |

### 큰 페이지에서도 같은가 — 229 블록에서 잰 값 (`…probe6.mjs`)

우리 e2e 와 같은 227 개 한글 문단을 스크래치 페이지에 만들고 마지막 블록에 글자를 하나씩 넣었다.

| 표본 | input→`Transaction` add | →쓰기 complete | →fetch | →응답 |
|---|---|---|---|---|
| 1 | 1.2 ms | 1.7 ms | 3.3 ms | 345 ms |
| 2 | 5.0 | 5.6 | 166 | 498 |
| 3 | 6.1 | 7.1 | 334 | 620 |
| 4 | 8.3 | 9.0 | 481 | 763 |
| 5 | 7.1 | 8.0 | 9.2 | 327 |
| 6 | 7.8 | 8.5 | 195 | 470 |

- **IndexedDB 쓰기 완료까지 2~9 ms.** 블록이 229 개여도 입력 처리와 로컬 저장이 렌더에 막히지 않는다.
  우리 에디터는 같은 조건에서 380~480 ms(React 가 227 행을 동기 리렌더한 뒤에 완료 이벤트가 온다).
- fetch 는 완료 뒤 0~480 ms 사이에서 흩어진다. 작은 페이지(§2)에서도 3~330 ms 로 흩어졌으니 페이지
  크기 때문이 아니고, 노션 큐가 고정 주기(≈500 ms) 로 비우는 것으로 보인다. 즉시 보내는 우리 큐와의
  차이는 사용자에게 보이지 않는 범위다.

## 3. 어디에 두나 — IndexedDB `TransactionStore`

- 스토어 `Transaction` (keyPath `index`, 인덱스 byId · bySessionId · byTimestamp · byUserId).
  레코드 = `{ id, userId, spaceId, timestamp, debug, operations[], sessionId, index }` — 보내는 트랜잭션 그대로.
- 스토어 `Session` (keyPath `index`, 인덱스 byOwnerSessionId · bySessionId · byUpdatedAt).
  레코드 = `{ sessionId, ownerSessionId, updatedAt, index }` — 탭(세션)이 살아 있음을 알리는 심장박동.
  **대기 트랜잭션이 있을 때만 존재한다**(큐가 비면 행도 없다 — 조용한 탭을 25 초 관찰해 0 행). 오프라인으로
  트랜잭션 하나를 대기시키고 40 초 관찰(`…probe8.mjs`): `updatedAt` 갱신 간격 **2,505 ms × 15 회**, 즉 2.5 초 고정.
- **모든 트랜잭션은 서버 200 이 오기 전까지 여기 있고, 오면 지운다.** 온라인에서 타이핑 중 재보면
  0건, 오프라인에서 5타 치면 5건, 복귀 후 0건.
- 실패했을 때만 저장하는 방식이 아니다. 보내기 **전에** 저장하고, **쓰기가 완료된 뒤에** 보낸다.
  글자 하나로 잰 순서(`…probe4.mjs`, `IDBObjectStore.add`·`complete`·`fetch` 를 감싸서):
  입력 0ms → `Session` add 2.3ms → `Transaction` add 2.6ms → 쓰기 complete 3.1ms → fetch 4.7ms → 응답 321ms.

## 4. 탭이 닫히면

- 저장 fetch 에 `keepalive` 를 **쓰지 않는다** (14건 전부 `keepalive:false`, `sendBeacon` 없음).
- 입력 10ms 뒤 탭을 닫으면 그 트랜잭션은 서버에 못 간다. 대신 IndexedDB 에 남는다.
- 새 탭이 같은 페이지를 열면 남은 트랜잭션(고아)이 그대로 보이고(`Transaction:1`, `Session:1`),
  **열고 약 8초 뒤** 큐가 비면서 글자가 나타났다.
- 회수 시점을 다시 잼(`…probe7.mjs`, 세 번): 탭을 닫은 시각 기준 **13.7 초**(닫고 바로 새 탭), **13.6 초**(이미 떠
  있던 다른 탭이 회수), 닫고 30 초 뒤 새 탭을 열었을 때는 **이미 회수되어 있었다**(떠 있던 골든셋 탭이 했다).
  즉 회수는 "새 탭이 열릴 때"가 아니라 **살아 있는 아무 탭이 주기적으로** 하며, 죽은 뒤 약 13.6 초다.
  2.5 초 박동으로 보면 5 박동(12.5 초) 놓친 세션을 고아로 보고 그 직후 검사에서 가져가는 값이다. 이 재전송은 페이지 컨텍스트의 네트워크에 잡히지
  않았다 — 노션은 shared worker(`wasm-sqlite-shared-worker`, `opfs-*-cache-worker`)와 service
  worker 를 두고 있어 그쪽에서 나간 것으로 보인다. 어느 쪽이 보내는가는 우리 구현에 중요하지 않다.
  **"다음 세션이 이전 세션의 미확인 트랜잭션을 회수해 보낸다"** 가 규칙이다.

## 5. 우리와의 차이 (2026-09-08 HEAD)

| | 노션 | ainmem |
|---|---|---|
| 전송 단위 | 바뀐 레코드의 연산 | 페이지의 모든 블록 |
| 페이로드 | ≈1KB, 문서 크기 무관 | 문서 크기에 비례 (이 사고의 페이지 65KB) |
| 로컬 보관 | 보내기 전 IndexedDB, 확인 후 삭제 | 실패했을 때만 localStorage, 24h 후 삭제 |
| 재시도 | 5초, 같은 id 로 멱등 재전송 | 5초, 전체 문서 재전송 |
| 동시 편집 | 글자 단위 병합 | 마지막 전체본이 덮어씀 |
| 탭 닫기 | keepalive 없음, 다음 세션이 회수 | keepalive(64KiB 한도, 바이트 아닌 문자 수로 판정) |
| 서버 응답 | `{}` | 전체 블록 목록 |

## 6. 구현 전에 정할 것

1. **텍스트 단위.** 노션처럼 글자 단위 CRDT 로 가면 동시 편집 병합까지 같아지지만, 텍스트
   모델·히스토리·MCP 쓰기 경로 전부가 바뀌는 큰 일이다. 블록 단위 `set content`(마지막 쓰기 승)로
   시작하면 1·2·3·4 절은 같아지고 동시에 같은 블록을 고칠 때만 다르다.
2. **서버.** 지금 `PUT /blocks` 는 부분 갱신을 받지만 멱등하지 않다(같은 요청을 두 번 보내면 두 번
   적용, 삽입은 중복). 트랜잭션 id 를 받아 한 번만 적용하는 엔드포인트가 필요하다.
3. **저장소.** localStorage 초안 → IndexedDB 큐(`Transaction`, `Session`) + 세션 심장박동 + 고아 회수.
