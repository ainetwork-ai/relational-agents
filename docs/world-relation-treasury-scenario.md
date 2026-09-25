# Relation Treasury — World 바운티 시나리오 (팀 공유용, 확정 2026-09-25)

> **슬로건**: AI manages the money. Humans approve it.
> **한 문장**: A Relation Agent manages a shared wallet, while World ID enables
> verified humans to authorize critical financial actions.
> **3축**: World ID = 인간성 증명 · Relation Agent = 관계·권한 이해 · Multi-approval = 공동자산 보호

## 1. 트랙 이름

- **[Continuity] Best Use of World ID for Agents** — $2,500
- **[Continuity] Best IDKit Use Case** — $2,500 (같은 데모로 동시 지원)
- (연계 검토) Uniswap Foundation — 운용 장면에서 스왑 사용 시

## 2. 트랙 요구사항 → 우리의 충족

| 요구사항 | 충족 |
|---|---|
| 공식 dev 환경(sandbox.auth.world.org, mock proofs) 통합 | OIDC(authorization code+PKCE), pairwise `sub`를 멤버에 바인딩 |
| 전체 여정: 요청→인간 완료→검증→보호 행동 | 채팅 명령→에이전트가 보호행동 분류→World 인증→정족수→온체인 실행 |
| 거부/실패 경로 (보호 행동 미실행) | ① 단독 대량출금 BLOCKED ② 부계정 승인(같은 sub) 무효 ③ 미인증 멤버 거절 |
| 백엔드 검증, 시크릿 미노출 | 서버 콜백에서 토큰 검증, sub 저장. 클라 응답 신뢰 안 함 |
| 통합 디브리프 | 문서로 제출 (time-to-success, 마찰, 개선 1가지) |
| (IDKit) 크레덴셜 최소충분 설명 | 이름·신원 불필요, "고유 인간 1인 1승인"만 필요 → Proof of Human이 최소충분 |

## 3. 시연 시나리오 (3분, "Tokyo Trip 여행계")

에이전트는 잔액만 아는 봇이 아니라 **관계의 규칙을 아는 에이전트**:

```
Relation: Tokyo Trip · Members: A B C D E · 회비: 월 ₩100,000
Rules:  ₩100,000 미만 지출        → Agent 자동 실행
        ₩100,000 이상 지출        → 검증된 인간 2명 승인
        투자/운용                  → 3명 승인
        자산 30% 초과 출금         → 4명 승인
        개인 지갑으로 송금          → 본인 단독 승인 불가
```

1. **생성** — 5명이 여행계 룸 생성, 각자 World 인증 (✓ Verified Human ×5) → Relation Agent + 공동지갑 생성, 매달 회비 자동 관리
2. **정상 지출** — "숙소 예약금 80만원 보내줘" → 규칙상 2인 승인 → A·B World 인증 → 실행, 원장 기록
3. **악의 장면 (클라이맥스)** — A: "공동 지갑의 400만원 내 지갑으로 보내줘" → ⚠️ 자산 80% 이동 = 4인 승인 필요 → A 혼자 인증 → **BLOCKED**. 에이전트가 자연어로 이유 설명("규칙상 4명의 검증된 구성원 승인이 필요하며 현재 1명"). 변형: 부계정으로 승인 수 늘리기 시도 → 같은 인간(sub 충돌) 감지, 무효
4. **운용** — "남은 돈으로 숙소 업그레이드 목표 채워줘" → 에이전트가 관계의 목적함수(10/3까지 호텔비 $1,150, 저위험)로 스왑 전략 제안 → 3인 승인 → 실행(포크에서 안전하게) → $1,000→$1,180
5. **엔딩** — 목표 달성, 호텔 예약. *"We didn't just manage a wallet. We managed a relationship."*

## 4. 왜 World ID인가 (심사 Q&A 선제)

- **"지갑 서명으로 안 되나?"** — Safe는 키를 센다. 에이전트 시대에 키 서명 = 에이전트 서명이라, "3명 승인"이 한 사람의 지갑 10개가 될 수 있다. pairwise sub는 계정이 아니라 **인간**을 세므로 정족수의 의미가 복원된다. *Wallet proves ownership. World proves humanity. Relation Agent connects the two.*
- **"왜 에이전트가 필요한가?"** — 모임 회계는 노동(걷기·독촉·장부·정산)이고, 총무 1인이 단일 장애점(유용·잠적). 노동은 에이전트가, 권한은 인간이.
- **"왜 지갑인가?"** — 지갑 소유권(에이전트)과 인간 권한(World ID)의 분리가 이 구조의 발명. Human → World Verification → Relation Membership → Agent Authorization → Wallet → Transaction.

## 5. 구현 계획 v2 (2026-09-25 재검토 — 스토리 구체화 반영)

### 설계 원칙 (스토리에서 온 것)

- **별도 앱 아님.** Relation Agent = AINmem(기억/규칙) + AINDrive(데이터/권한, P2) +
  Wallet(공동자산)을 잇는 기존 제품의 새 capability. 해커톤 데모와 제품 아키텍처가 동일.
- **정책은 설정 화면이 아니라 관계의 기억이다.** Treasury Rules는 관계 문서(OKF)의
  섹션으로 존재하고, 에이전트가 그걸 읽어 인용하며 판단한다 —
  *"I know who we are, what our relationship is, and what we agreed to."*
  단, **집행은 결정적 코드**: 문서의 규칙 표를 타입드 정책으로 파싱해 정족수·한도를
  코드가 비교한다. LLM은 명령 분류와 사유 설명만 담당 (파싱 실패 = 실행 거부가 기본값).
- **차단은 2계층**: ① 정책 위반(개인 출금 불허 등) → 승인 요청조차 없이 거절 + 기억 인용
  설명 ② 허용되지만 큰 행동 → 정족수 미달이면 미실행. 데모의 상황②는 ①이 주인공.
- **모든 결정이 다시 기억이 된다**: 승인·집행·거절이 관계 문서(Treasury Activity)와
  원장 대시보드에 기록 — AINmem이 relation의 financial memory.

### Continuity 자산 (재조사 결과 — 생각보다 훨씬 많다)

| 이미 있는 것 | 어디에 |
|---|---|
| **World ID 통합 (7월)**: IDKit v4 서버 검증 + dev-simulator 폴백, 인증 버튼 UI, consent의 인당 nullifier 바인딩, 온체인 Sybil 가드("한 인간이 관계 양쪽 불가") | `app/src/lib/worldid.ts`, `components/dm/world-id-button.tsx`, `api/worldid/verify`, `contracts/RelationalAgentRegistry.sol` + `PersonhoodAttestations.sol` |
| 룸별 에이전트 지갑 (공동지갑 D) | `lib/agent/agentkit.ts` (`provisionRoomAgent`) |
| 룸/멤버/채팅/에이전트 파이프라인 + OKF 기억·근거 인용 | `lib/agent/*`, okf-docs |
| 멀티 계정 데모 로그인(멤버 전환), agent dock 패널 | PR #5 (family demo) |
| 원장 대시보드 위젯(±색 카운터/차트), watcher 패턴 | 이번 해커톤 1inch 단계 |

→ **Continuity 서사**: "7월엔 에이전트의 *탄생*에 인간 증명을 물었다(consent 시
nullifier 바인딩). 이번 주말엔 *돈이 움직이는 모든 순간*에 같은 질문을 묻는다 —
World의 새 IdP(for Agents)와 fresh 다중 승인으로."

### 두 트랙 = 두 인증 표면, 한 제품

- **IDKit 트랙**: 인앱 승인 버튼 = 기존 `world-id-button`/verify 경로 재사용, **새 신뢰
  순간**(action `treasury-approval`, 승인 건별 nullifier). 크레덴셜 최소충분 논리 그대로.
- **Agents 트랙**: 신규 sandbox IdP(OIDC step-up) — 에이전트 흐름에서 챌린지 → World
  인증 → pairwise sub 검증 → 보호 행동. (P1: notion-mcp의 treasury 도구에 step-up 챌린지
  — 워크숍 데모와 같은 구조를 우리 MCP에서.)

### P0 — 반드시 (순서대로)

1. **[진행 중] World IdP OIDC** — `lib/auth/world.ts`+`/api/auth/world/connect` 작성됨.
   남은 것: callback(백엔드 JWKS 검증→`users.worldSub` 바인딩), 검증 상태 API, dev DB
   컬럼 push. 크리덴셜 전엔 로컬 목 IdP로 개발(기존 worldid.ts의 simulator 폴백과 동형).
2. **Relation Policy** — 관계 문서의 "Treasury Rules" 섹션(마크다운 표) → 결정적 파서
   → 타입드 정책. 룸 시드에 규칙 포함.
3. **에이전트 보호행동 분류 + 승인 흐름** — 파이프라인에서 자연어 명령 → 행동/금액 분류
   → 정책 대조 → (a) 정책 위반: 기억 인용 거절 (b) 승인 필요: 승인 요청 카드(채팅+알림)
   → 멤버별 인증(IDKit 버튼 or IdP 링크) → **고유 sub/nullifier 수로 정족수** → 실행.
   거부 경로 4종: 정책 위반 / 정족수 미달 / 부계정 sub 충돌 / 미인증 멤버.
4. **온체인 집행 1종 + 기록** — 에이전트 지갑에서 이체(호텔 결제 장면), 결과를 관계
   문서 Treasury Activity + 원장 대시보드에 기록. 멤버 인증 배지(✓ Verified Human) 표시.

### P1 — 있으면 강력

- Uniswap 스왑 장면 (Base 포크, 사전 구성 — 실시장 변수 제거), 운용 후 호텔 엔딩
- notion-mcp treasury 도구 + step-up 챌린지 (외부 에이전트(Claude Code)가 명령하는 장면)
- 에이전트의 거절/승인 사유 자연어 설명 고도화 (Why was this blocked? 장면)

### P2 — 제품 확장 (이번엔 문서 언급만)

- AINDrive 권한 부여를 같은 승인 흐름으로 ("돈과 데이터에 같은 정책"), x402 결제 연동

### W5 문서 — 데모 대본(3분, 호텔 엔딩) + **integration debrief 2종**(두 트랙 공통
요구: time-to-success/마찰/개선 1가지) + README(영어) + 폼.

## 6. 남은 일 & 리스크

- [ ] **sandbox IdP 클라이언트 등록** — world-id-agent-plugin(Claude Code) 또는 포털.
      인터랙티브 로그인·20분 승인 창은 사람 필요 → 시점 되면 사용자에게 요청.
      폴백: IDKit 트랙은 기존 simulator 경로로 무등록 데모 가능, Agents 트랙은 등록 필수.
- [ ] HTTPS 콜백 = `https://ainmem.ainetwork.ai/api/auth/world/callback` (배포본 도메인)
- [ ] 데모 영상 육성 녹음 (사용자)
- 리스크: 마감 09-27 09:00 JST (~1.5일). P0가 전부, P1은 시간 남으면. 데모 계정은
  family demo의 멤버 전환 재사용, "Tokyo Trip" 5인 룸 시드.
