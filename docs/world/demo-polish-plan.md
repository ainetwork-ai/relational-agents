# Relation Treasury 데모 폴리시 통합 계획

현재 상태 (감사 시점, 아무것도 바꾸지 않음): localhost는 `idpMode:"mock"`이고, 6명 중 5명이 `seatLevel:"dev-simulator"`, 잔액은 $820, $150 요청이 1/2로 대기 중입니다. 오늘 촬영하면 모든 테이크에 `(mock IdP)`, `LOCAL MOCK IDP`, `Local mock — not World` 페이지, `dev vote` 칩 5개가 나옵니다. UI를 다듬기 전에 **어디서 찍을지(prod)와 scene 4 대본**부터 정해야 합니다.

---

## 0. 녹화 전 선행 조건 (UI 외, 합계 약 165분)

- **P0 [차단] Scene 4 대본 확정: "Alex가 Dana의 노트북을 집어든다" (20분)**
  - 현재 대본은 성립하지 않습니다. `approvalGate`가 투표권 없는 계정에 `not-seated`를 돌려주고(approvals.ts:396, 코드에서 확인), scene 2에서 Alex (2nd account)는 투표권을 거절당합니다. 그러면 그 계정에는 Approve 버튼이 없습니다.
  - 새 흐름:
    1. Alex가 $150을 승인해 1/2가 됩니다.
    2. 이미 투표권이 있고 아직 IdP step-up을 한 적 없는 Dana 계정에서 Alex의 World ID로 다시 승인합니다.
    3. `bindWorldSub`가 `sub-taken`을 돌려주고, 같은 approverKey의 이전 승인이 있으므로 `⛔ An approval was voided: the same human already approved from another account.`가 올라갑니다. 카드는 1/2에 머뭅니다. 코드 경로는 approvals.ts:492-500에서 확인했습니다.
  - Scene 2는 "투표권 단계의 IDKit nullifier", scene 4는 "지출 단계의 IdP sub"가 되어 World 제품 둘이 각자 한 가지 일을 합니다.
  - DEMO.md scene 4와 §4 리허설 매핑(그 테이크에서는 Dana 계정 = Human 1)을 고칩니다.
  - 내레이션에 "투표권 보유자 본인만 승인할 수 있다"는 말은 넣지 않습니다. 투표권 nullifier와 IdP sub는 연결되어 있지 않아서, 판정단이 짚을 수 있습니다.
- **P1 [차단] 촬영은 전부 https://memory.ainetwork.ai 에서, UI 수정은 배포 한 번으로 묶기 (30분)**
  - sandbox IdP client의 redirect는 memory.ainetwork.ai 하나뿐이고 localhost 등록은 거절됐습니다(integration-log 02:39). 그래서 localhost는 영원히 mock입니다.
  - prod 빌드에서는 Next dev 표시(`N 2 Issues`)도 사라집니다.
- **P2 [차단] prod에서 sandbox IdP 드라이런 (15분)**
  - 승인 2명이 필요한 요청을 하나 만들고 한 번만 승인해 1/2에서 멈춥니다. 돈은 나가지 않습니다.
  - 초록 배너가 뜨는지 확인합니다. 이것은 id_token에 `auth_time`이 들어 있는지 확인하는 일입니다. 없으면 approvals.ts:484가 fail-closed로 `stale-proof`를 내고, scene 3·4가 전부 빨간 결과가 됩니다. 그 경우 대책(World에 문의하거나, 플래그를 단 iat 폴백)을 촬영 전에 정합니다.
  - sandbox 화면을 스크린샷으로 남기고 걸리는 시간을 재서 컷 포인트를 잡습니다. integration-log는 아직 "Still to measure" 상태입니다.
- **P3 최종 reset (20분)**
  - prod 컨테이너 안에서 `seed-tokyo-trip.mts --reset --no-preseat`를 실행합니다. OKF 디스크, DB, RELAYER_KEY가 그 컨테이너에 있기 때문입니다.
  - 새 agent 지갑이 $1,000인지, 사이드바 트리가 새 프로필로 다시 만들어졌는지 확인합니다.
  - 순서는 리허설 → 최종 reset → 투표권 claim만 → 촬영입니다.
  - DEMO.md setup 1단계("Chris·Dana·Eli already have a vote")가 3단계와 어긋나므로 `--no-preseat` 기준으로 고칩니다.
- **P4 시뮬레이터 신원 (20분)**
  - simulator.worldcoin.org 신원을 Alex, Chris, Dana, Eli에 각각 따로 둡니다.
  - Chris, Dana, Eli는 촬영 밖에서 claim하고, Alex는 scene 1에서 촬영 중에 claim합니다. Alex2는 Alex의 신원을 씁니다(scene 2 거절 장면).
  - IdP에서는 Chris와 Alex가 서로 다른 World ID여야 합니다. Dana는 scene 4 전까지 절대 step-up하지 않습니다.
  - Developer Portal 앱 이름을 `ETHTokyo2026`에서 `Relation Treasury`로 바꿉니다(IDKit 시트에 표시됨). action id인 `treasury-seat`는 그대로 둡니다.
- **P5 테이크마다 pre-flight (5분)**
  - `GET /api/dm/rooms/<room>/treasury`가 `idpMode:"sandbox"`, `seatMode:"world-id-v4"`를 돌려주고, `dev-simulator` 좌석이 0개이며, 잔액이 $1,000.00이어야 합니다.
- **P6 브라우저 세팅 (25분)**
  - 사람마다 Chrome 프로필을 하나씩 만듭니다(Alex, Alex 2nd, Chris, Dana). 프로필 색을 다르게 해서 계정을 바꿀 때 창 테두리가 바뀌게 합니다.
  - 각 프로필은 demo-login을 한 번씩 하고, memory.ainetwork.ai에 `lang=en` 쿠키를 넣습니다.
  - **1920x1080 창에 125% 줌**, 북마크바와 확장 프로그램이 없는 깨끗한 프로필, 탭 없는 앱 창(Etherscan만 예외), 사이드바는 Chats 탭으로 둡니다.
  - 에이전트 독, 인박스, 홈, 헤더 툴팁은 화면에서 절대 열지 않습니다.
  - 사람마다 시뮬레이터 창을 하나씩 "그 사람의 폰"으로 둡니다. Alex의 폰 하나가 Alex, Alex2, Dana의 노트북에 모두 답하는 구도가 곧 "one human" 이야기입니다.
- **P7 샷 리스트와 사전녹화 (30분, DEMO.md)**
  - 사전녹화:
    - scene 1의 IDKit 단계(약 14초)
    - scene 2 전체
    - scene 3의 IdP 두 번. 약 40초 걸리는 체인 대기는 점프컷에 캡션 `~40 s later on Sepolia`를 붙입니다.
    - scene 4 전체. Approve 클릭부터 voided 줄까지는 자르지 않습니다.
  - 라이브: scene 1 도입부, $180 요청, Etherscan, scene 5, scene 6.
  - 편집 캡션:
    - scene 1–2: `World ID · IDKit — Proof of Human`
    - scene 3–4: `World ID for Agents — fresh step-up`
    - 계정 전환: `Chris's laptop`
    - Etherscan: 테스트넷 고지
  - DEMO.md 수정:
    - scene 1의 "beside"를 "one click away"로
    - scene 3·5의 인용문을 M7·M8 반영 후 새 문구로
    - scene 6 내레이션을 "every payment, who approved it, and every refusal"로
- **P8 폴백 (0분)**
  - 당일 sandbox가 실패하면 확인 페이지에서 방으로 바로 점프컷합니다. mock IdP 페이지는 절대 화면에 넣지 않습니다.

---

## 1. MUST — 녹화 전 필수 (합계 265분)

| # | 무엇을 바꾸나 | 파일 | 분 | 장면 |
|---|---|---|---|---|
| M1 | **대기 카드 재구성.** 두께 6px 진행바 대신 필요 승인 수만큼 슬롯을 둡니다. 채운 슬롯은 emerald로 `✓ Chris · 14:02`(`approvals[].at`, Asia/Tokyo 시각)이고, 이것이 "지금 한 인증"의 증거가 됩니다. 빈 슬롯은 점선으로 `verified human`. 오른쪽에 `1 of 2 verified humans`. 제목은 `text-xl` `$150.00 to Hotel Gracery Shinjuku`(memo는 단어를 더할 때만). 둘째 줄 `requested by Alex · expires in 10 h · 0x466e…CB86`은 `text-sm`. 규칙 인용은 `border-l-2 italic`, 카드는 `p-4 shadow-sm`. 이미 승인한 사람에게는 `✓ You approved — waiting for 1 more human.`. 투표권 없는 사람에게는 `No vote on this account — only verified humans can approve.`. 버튼은 `🌍 Approve with World ID`에 `px-4 py-2 font-semibold`. aria는 슬롯 줄로 옮깁니다. | treasury-panel.tsx:497-585 | 50 | 3, 4 |
| M2 | **패널 헤더와 칩 정리.** 헤더는 muted `Shared treasury` 뒤에 `text-base font-semibold tabular-nums` 잔액, 오른쪽에 muted `AI manages the money · humans approve it`(접혀 있어도 보임). 칩 앞에 `One human, one vote` 라벨. 칩 문구는 `Alex · 🌍 vote`와 `Alex (2nd account) · no vote`("no vote yet"은 쓰지 않음). `✓ World ID` span은 지우고 tooltip으로 옮깁니다. 보는 사람 칩에는 `(you)`를 붙입니다(status.members에 `me` 추가). dev 좌석은 amber로 구분해 둡니다. `Sepolia · testnet scale`은 본문 첫 줄 `Agent wallet 0xc299…690f · Sepolia testnet`으로 바꾸고, tooltip은 `Testnet demo: $1 = 0.000005 SepETH`. | treasury-panel.tsx:267-316,386-416; approvals.ts:1129; types.ts | 30 | 전체 |
| M3 | **멤버 칩과 헤더 아바타 순서 고정.** `.orderBy(asc(joinedAt), asc(userId))`를 방 GET(ORDER BY가 없음), treasuryStatus, memory, skill 쿼리에 넣습니다. 시드는 PEOPLE 순서로 joinedAt을 1초씩 벌려 Alex, Bea, Chris, Dana, Eli, Alex (2nd account) 순이 되게 합니다. reset 후에 적용됩니다. | api/dm/rooms/[roomId]/route.ts:65-68; approvals.ts:996; memory.ts:118; skill.ts:252; seed:250-253 | 15 | 1–4 (계정 전환) |
| M4 | **Scene 1 claim 흐름.** 투표권이 없으면 `open = … \|\| !status.mySeated`로 자동으로 펼칩니다. claim에 성공하면 `setOpenOverride(true)`로 열린 상태를 고정해, 칩이 `🌍 vote`로 바뀌는 순간 패널이 접히지 않게 합니다. 성공 배너는 `🌍 Vote claimed — World ID confirmed you're a unique human. One human, one vote.` | treasury-panel.tsx:266, SeatButton onClaimed | 15 | 1 |
| M5 | **결과 배너.** 문구 대신 코드를 저장합니다. 코드가 `executing`이고 이력의 최신 항목이 executed면 executed 문구로 바꾸고, 실패나 blocked면 배너를 내립니다. 지금은 결제 장면의 마지막 화면에서 "paying now…"가 그대로 남습니다. 문구에서 전문용어를 뺍니다. approved `✅ Approved — World ID confirmed a unique human, just now.`, executing `✅ That was the last approval needed — the agent is paying now.`, executed `… — the agent paid.`, same-human `⛔ Not counted — this human already approved from another account. One human, one vote.`. stale-proof와 not-seated도 story lens 문구로 바꿉니다. | treasury-panel.tsx:39-84,154,327 | 20 | 3, 4 |
| M6 | **승인 채팅 줄에 신선도 표시.** `✅ Chris approved with World ID — 1 of 2 · fresh check at 14:02, after this request`. e2e:431 정규식(`Chris approved with World ID — 1 of 2`)과 계속 맞습니다. World ID for Agents 판정단에게는 이 부분이 통합의 핵심입니다. | approvals.ts:540-544 | 15 | 3, 4 |
| M7 | **에이전트 답변 줄바꿈과 압축.** 버블이 pre-wrap이므로 `\n`으로 나눕니다. Queued는 3줄입니다. `⏳ Queued: $180 to Hotel Gracery Shinjuku (hotel deposit).` / `Needs 2 verified humans — our rules: “…”` / `Approve with World ID in the treasury panel above.`. "one human counts once" 문장은 빼서 scene 4의 반전을 남겨 둡니다. $700 거절도 줄 단위로 나눕니다(`I won't do that.` / 규칙 / `$700 is also 85.4%…` / 목적 / `Rules: /p/…`). `would also be`는 `is also`로. adoption 답변(skill.ts:608)도 같게 맞춥니다. | skill.ts:107-109,331-334,381-391,511-515,608; DEMO.md; e2e 366/475 확인 | 25 | 3, 5 (클라이맥스) |
| M8 | **결과 기록(채팅 Paid 줄과 Treasury Activity 페이지).** 채팅은 `✅ Paid $180 to Hotel Gracery Shinjuku (hotel deposit).\nApproved by 2 verified humans: Chris and Alex · tx 0xbf04…`로, gas 부연은 뺍니다. Activity는 `✅ Paid … — approved by Chris and Alex · [tx 0xbf04…bcab](https://sepolia.etherscan.io/tx/…)`로 쓰고, refund tx와 relayer 문구는 뺍니다. 요청 줄은 `📝 Alex asked: $180 · hotel deposit — needs 2 humans to approve`, 거절 줄은 `⛔ Refused: $700 to Alex's own wallet — “…”`. 승인 줄(M6과 같은 문장)과 voided 줄을 `logActivity`로 추가합니다. 날짜 제목은 ISO 대신 Intl로 만든 `Friday, Sep 25` 형식이고, memory.ts와 시드 isoDay를 함께 바꿉니다(dedupe 키이므로 최종 reset 전에). | approvals.ts:488-500,540,881-891; skill.ts:378,508; memory.ts:211-229; seed:319-320; e2e 378/429 | 40 | 3, 6 (마지막 화면) |
| M9 | **메모리 문서 이름.** index.md가 있는 폴더는 사이드바와 breadcrumb에 폴더명 대신 index의 `# ` 제목을 씁니다. 그러면 `-b96c89` 같은 해시 접미사가 사라집니다. 더 가벼운 폴백은 `/-[0-9a-f]{6}$/`를 제거하는 것입니다. | okf-store.ts:136-160,185-195 | 20 | 1, 6 |
| M10 | **확인 페이지 최소 정리.** `body{min-height:100vh;display:grid;place-items:center}`, main 34–36rem, 카드 padding과 그림자, h1 40–44px. 킥커는 `Tokyo Trip · shared treasury → World ID for Agents`(ApprovalCard에 roomName 추가). `Approving as Chris`를 넣습니다. `Paid to`는 `Sends to`로. 승인 줄은 `Approved so far: Alex — 1 of 2 needed`. 만료는 `in 10 h (19:12 Tokyo)`. 버튼 위에 `The agent can't send this until 2 different humans approve it with World ID.`, 버튼은 `🌍 Approve with World ID`. 전체 주소와 CSP는 유지하고, 폰트는 system-ui 그대로 둡니다. | connect/route.ts:183-257; approvals.ts(ApprovalCard) | 25 | 3 (4초 정지 화면) |
| M11 | **시드 reset에서 알림 삭제.** 데모 유저 6명(또는 roomId 기준)의 `notifications`를 지웁니다. 새 $180 요청 때 Chris의 벨이 0에서 1로 바뀌는 게 오히려 좋은 장면이 됩니다. 폴백은 각 프로필에서 "Mark all as read". | seed:116-161 | 10 | 3 (Chris 화면) |

---

## 2. SHOULD — 시간이 되면 (합계 215분)

| # | 무엇을 바꾸나 | 파일 | 분 | 장면 |
|---|---|---|---|---|
| S1 | **패널 시각 정리 나머지.** 칩을 흰색 중립 스타일로 바꿔 125% 줌에서 한 줄에 들어가게 합니다. 섹션은 `mx-0`. 잘린 purpose 줄은 삭제합니다. 지갑 줄 오른쪽에 `📄 Our rules →` 링크. | treasury-panel.tsx:369-416 | 20 | 전체 |
| S2 | **채팅 결과 톤.** 에이전트의 `✅` 메시지는 `bg-emerald-50 ring-emerald-200`, `⛔`와 `I won't do that`는 `bg-red-50 ring-red-200`. | dm-view.tsx:962-967 | 25 | 3, 4, 5 |
| S3 | **voided 문구를 구체적으로.** `⛔ Not counted: the World ID just verified on Dana's account already approved this payment from another account. One human counts once — still 1 of 2.` 일치한 사람이 누구인지는 적지 않습니다(아래 충돌 해소 참고). voided 문자열을 검사하는 e2e가 있는지 확인합니다. | approvals.ts:487-500,528-536 | 15 | 4 |
| S4 | **Sepolia 대기 구간.** 정족수를 넘은 직후, transferUsd 전에 `⏳ 2 of 2 verified humans — paying $180 to Hotel Gracery Shinjuku on Sepolia now.`를 올려 점프컷 시작점을 만듭니다. paying 카드에 펄스와 경과 초를 표시합니다. Paid를 먼저 올리는 옵션은 쓰지 않습니다(잔액이 $819.xx로 보임). | approvals.ts(transferUsd 직전); treasury-panel.tsx:551-559 | 20 | 3 |
| S5 | **패널이 늦게 떠서 채팅이 밀리는 문제.** refresh에서 TreasuryStatus를 sessionStorage에 캐시하고, 마운트 effect에서 적용합니다(hydration 안전). `dm-messages`에 ResizeObserver를 달아 원래 바닥에 있었으면 다시 바닥에 붙입니다. | treasury-panel.tsx; dm-view.tsx | 25 | 2–4 (IdP에서 돌아올 때) |
| S6 | **"memory"로 이름 통일하고 태그는 한 번만.** en.ts에서 `Our memory`, `Memory`, `What the agent remembers from this room`, `Remembered`, ` · The agent remembers what's said here`로 바꿉니다. `Remembered` 태그는 연속된 기록 묶음의 마지막 메시지에만 붙입니다. 시드 대사는 `Deal. The agent has our rules in its memory now.` | en.ts:19,116,136,137,203; dm-view.tsx:725-730,992; seed:223 | 25 | 1 |
| S7 | **`group` 프로필 추가.** 문서 제목 `Shared memory`, 🧠, 섹션은 Overview만 두고 나머지는 시드의 treasury 4페이지가 채웁니다. 비어 있는 business 섹션 6개와 `Working record`가 사라집니다. 대안은 scene 6 전까지 사이드바 트리를 접어 두는 것입니다. | profiles/group.ts + registry; okf-docs.ts:94,130; seed:256-265 | 45 | 6 |
| S8 | **World 쪽에 보이는 문구.** action_description을 `Claim your vote in this group's shared treasury — one human, one vote.`로, 거절 문구를 `This human already has a vote here — one human, one vote.`로 바꿉니다. `SAME_HUMAN_SEAT`와 `MSG.seatSameHuman`은 함께 바꿔야 합니다(다르면 두 줄로 찍힘). | seat-button.tsx:145; treasury-panel.tsx:86; approvals.ts:66 | 10 | 1, 2 |
| S9 | **claim 박스 재스타일.** 점선을 실선 `bg-neutral-50` 박스로 바꾸고, 제목 `Claim your vote`, 오른쪽에 버튼. seat-button의 `mt-2`는 제거합니다. | treasury-panel.tsx:424-469; seat-button.tsx:136 | 10 | 1 |
| S10 | **"Edited just now" 모순.** OKF 페이지의 updatedAt을 파일 mtime으로 바꿉니다. 패널 링크를 `📄 Our rules · adopted Sep 25 →`로 해서 "adopted version" 내레이션을 화면으로 받쳐 줍니다. Rules 페이지 안에 callout은 넣지 않습니다. 모든 줄이 규칙으로 파싱되어 fail-closed가 됩니다. | okf-store.ts:503; treasury-panel.tsx:374-381 | 20 | 1 |

---

## 3. COULD — 나중에 (합계 265분)

| # | 무엇을 바꾸나 | 파일 | 분 | 장면 |
|---|---|---|---|---|
| C1 | 넓은 화면에서 패널을 채팅 오른쪽에 도킹 | dm-view.tsx; treasury-panel.tsx | 120 | 전체 |
| C2 | 잔액이 바뀔 때 1.2초 emerald 플래시, 90초 안에 결정된 최신 이력은 색으로 강조(`decidedAt` 필요) | treasury-panel.tsx; approvals.ts; globals.css | 25 | 3, 5 |
| C3 | 문서 페이지 아이콘을 frontmatter `icon:`으로(🏦 Rules, 📒 Activity, 🎯 Purpose, 🏨 Payees) | okf-store.ts; p/[pageId]/page.tsx; seed | 30 | 1, 6 |
| C4 | 에이전트 독을 `/dm/*`에서 숨기기, SUGGESTIONS를 `t()`와 영어로, 이름을 `${ws.name} agent`로(저장된 user row도) | assistant-dock.tsx:24; api/assistant/route.ts:43 | 15 | 전체 |
| C5 | 사람마다 다른 색 아바타(SVG data URI). Alex2는 Alex와 다르게, 에이전트는 🏦 | seed | 20 | 전체 |
| C6 | `document.title = "Tokyo Trip · Shared treasury"` | dm-view.tsx | 5 | 탭이 보일 때만 |
| C7 | 인박스 treasury 알림 제목(`Alex asked the group to approve a payment`) | inbox.tsx:38-46 | 15 | 인박스(화면에 안 나옴) |
| C8 | IDKit 성공 후 약 1.5초 뒤 자동으로 닫기 | seat-button.tsx:150-162 | 10 | 1 |
| C9 | `devIndicators`를 env로 게이트(`HIDE_DEV_INDICATOR`), 방 페이지에서 catch 없는 fetch에 catch 추가 | next.config.ts; dm/[roomId] | 25 | 로컬 리허설 |

홈의 `aindrive is not configured`, 워크스페이스 이름 잘림, `Page` 탭은 코드를 고치지 않고 화면에 넣지 않는 것으로 처리합니다.

---

## 4. 렌즈끼리 충돌한 부분과 결정

1. **Scene 4 해법:** Bea 계정(visual), scene 2에 합치기(story), Dana 계정(flow·judge)이 나왔습니다. **Dana로 정했습니다.** `--no-preseat` 계획에서 투표권이 확실히 있는 사람은 Chris, Dana, Eli라 Bea는 불확실합니다. scene 2에 합치면 IdP sub로 계정 간 중복을 걸러내는, World ID for Agents 쪽의 핵심 장면이 사라집니다. story의 투표권 없음 카드 문구는 M1에 넣었고, 원하면 2초짜리 컷으로 쓸 수 있습니다.
2. **devIndicators:** 네 렌즈 모두 MUST로 봤지만 prod 촬영(P1)으로 저절로 해결되므로 **COULD로 내렸습니다.** 공유 dev 서버에서는 env 게이트로만 켜고 끕니다.
3. **칩 정렬:** 클라이언트에서 투표권 있는 사람을 앞으로(story) 대 서버에서 결정적으로(나머지)였습니다. **서버 쪽으로 정했습니다.** 투표권 우선 정렬이면 scene 1에서 Alex가 claim하는 순간 칩 위치가 바뀝니다.
4. **Purpose 줄:** 삭제(visual), `For:` 접두사(story), 두 줄 clamp(flow·judge)가 나왔습니다. **삭제로 정했습니다.** 125% 줌에서는 높이가 가장 모자라고, scene 5 거절문과 Purpose 페이지에 같은 내용이 나옵니다.
5. **헤더 자리:** 테스트넷 pill과 Rules 링크(visual) 대 슬로건(story)이었습니다. **헤더에는 슬로건**을 두고, 지갑·테스트넷·Rules 링크는 본문 첫 줄로 옮깁니다. 판정단이 슬로건을 볼 수 있는 곳이 여기뿐입니다.
6. **Queued 답변:** 짧은 CTA(visual) 대 3줄 구조(story)였습니다. **3줄 구조에 짧은 CTA를 씁니다.** "one human counts once"는 빼서 scene 4의 반전을 아낍니다.
7. **Activity 요청 줄 이모지:** ⏳(story) 대 📝(visual)였습니다. **📝로 정했습니다.** 요청은 사건이고, ⏳는 결제된 뒤에도 대기 중처럼 읽힙니다.
8. **날짜 제목:** story의 예시 `Thu, Sep 25`는 요일이 틀렸습니다(2026-09-25는 금요일). 게다가 제목은 녹화 당일 날짜가 됩니다. 그래서 **Intl로 계산하고 하드코딩하지 않습니다.**
9. **voided 문구의 이름 노출:** judge는 "Dana 계정에서 인증한 사람이 Alex와 같은 사람"이라고 밝히자고 했습니다. **시도한 계정(Dana)만 적고, 일치한 사람은 적지 않습니다.** World ID의 비연결성 원칙상, 방 전체에 어떤 계정들이 같은 사람인지 알릴 필요는 없습니다. World 엔지니어가 짚을 수 있는 부분입니다.
10. **녹화 해상도:** 1440x900(judge) 대 1920x1080 @125%(visual·flow)였습니다. 최종 영상이 1080p이므로 **1920x1080 @125%**(CSS 1536x864)로 정했습니다.
11. **확인 페이지 폰트:** 앱 폰트 인라인(flow) 대 system(judge·visual)이었습니다. CSP가 `default-src 'none'`이고, 녹화할 맥에서는 system-ui가 SF로 나오므로 **system-ui를 유지합니다.**
12. **우측 도킹 레이아웃:** visual은 SHOULD로 봤지만 **COULD로 내렸습니다.** 120분짜리이고 녹화 당일 위험이 가장 큰 변경입니다. 125% 줌, 채팅 장면에서 패널 접기, 컷만으로도 충분합니다.
13. **문서 이름:** 사이드바 해시 제거(M9)는 필수로, `group` 프로필(S7)은 선택으로 나눴습니다. 해시는 가짜처럼 보이지만, 비어 있는 business 섹션은 트리를 접어 두면 가릴 수 있습니다.

---

## 5. 합계와 권장 순서

- MUST UI: **265분**
- SHOULD: **215분**
- COULD: **265분**
- 선행 조건: **165분**
- 최소 경로(MUST + 선행 조건): 약 **7시간**

권장 순서:
1. P0 대본 확정
2. P2 드라이런(`auth_time` 확인이 가장 큰 불확실성이라 먼저)
3. MUST 코드 수정(가능하면 SHOULD S2·S3·S4까지)
4. P1 prod 배포 한 번
5. P3 최종 reset
6. P4 claim
7. P5 pre-flight
8. P6·P7 녹화

감사 중 코드와 시드는 건드리지 않았습니다. 캡처는 `/mnt/newdata/comcom_data/tmp/claude-1000/-mnt-newdata-git-notion/b7ef8e2d-0f75-4314-a74e-19af65e14fd4/scratchpad/demo-audit/`에 있습니다.