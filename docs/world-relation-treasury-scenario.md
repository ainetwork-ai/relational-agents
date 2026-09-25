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

| 이미 있는 것 | 어디에 | 리뷰 교정 |
|---|---|---|
| **World ID 통합 (7월)**: IDKit v4 서버 검증, 인증 버튼 UI, consent의 인당 nullifier 바인딩, 온체인 Sybil 가드 | `lib/worldid.ts`, `components/dm/world-id-button.tsx`, `api/worldid/verify`, `contracts/*` | ⚠️ dev-simulator 경로는 IDKit이 **아님**(서버 자작 nullifier) — 심사용은 Portal staging app + 공식 simulator로 진짜 proof 필요 |
| 에이전트 지갑 인프라 (spend/agentkit, sepolia, native transfer + 펀딩 톱업) | `lib/agent/agentkit.ts`, `spend.ts` | ⚠️ **키 발급이 8/3 커밋에서 제거됨**(`provision.ts`) — 복원 필수, ERC20 미구현이라 **ETH native로** |
| 룸/멤버/채팅/에이전트 파이프라인 + OKF 기억·근거 인용, **결정적 스킬 매처 선례**("돈 명령은 모델이 아니라 문장으로") | `lib/agent/respond.ts:385`, `family-skills.ts` | treasury 분류는 `matchFamilySkill` 옆자리 |
| 멀티 계정 데모 로그인(멤버 전환), **consent-banner**(멤버별 배지+인증 버튼+폴링) | PR #5, `components/dm/consent-banner.tsx` | 승인 UI는 consent-banner 복제. ~~agent dock~~(개인 어시스턴트 패널이라 제외) |
| 원장 대시보드 위젯(±색 카운터/차트), watcher 패턴, 알림(`notifyConsent`) | 1inch 단계, `lib/notifications.ts` | |

→ **Continuity 서사**: "7월엔 에이전트의 *탄생*에 인간 증명을 물었다(consent 시
nullifier 바인딩). 이번 주말엔 *돈이 움직이는 모든 순간*에 같은 질문을 묻는다 —
World의 새 IdP(for Agents)와 fresh 다중 승인으로."

### 두 트랙 = 두 인증 표면, 한 제품

- **IDKit 트랙**: 인앱 승인 버튼 = 기존 `world-id-button`/verify 경로 재사용, **새 신뢰
  순간**(action `treasury-approval`, 승인 건별 nullifier). 크레덴셜 최소충분 논리 그대로.
- **Agents 트랙**: 신규 sandbox IdP(OIDC step-up) — 에이전트 흐름에서 챌린지 → World
  인증 → pairwise sub 검증 → 보호 행동. (P1: notion-mcp의 treasury 도구에 step-up 챌린지
  — 워크숍 데모와 같은 구조를 우리 MCP에서.)

### 리뷰로 확정된 설계 결정 (2026-09-25 밤, 3-에이전트 교차 리뷰)

- **승인 = 건별 fresh 의식(ceremony), 저장값 조회 아님.** "worldSub 1회 바인딩 후
  카운트"는 트랙이 배제한 '로그인 붙이기'다. 승인 행위의 식별자는 **IDKit nullifier
  (action `treasury-approval`, signal=actionId)**, `users.worldSub`(IdP)는 멤버십
  배지·계정 단위 인간 바인딩용. IdP 표면은 `max_age=0`+`auth_time` 창 강제.
- **표면↔순간 고정 매핑**: 인앱 멤버 승인 = IDKit(사람이 화면 앞) / 에이전트가 발신하는
  step-up = IdP(부재중 인간 소환). 데모·README에 명시. 승인 카드는 **에이전트가 채팅에
  게시**(에이전트가 챌린지 발행 주체로 보이게).
- **시빌 장면 = 바인딩 시점 거절**: `worldSub` unique 위반(23505)을 "이 인간은 이미
  이 관계의 좌석을 보증함" 카드로 렌더. 승인 중복은 unique(actionId, approverKey)가
  자연 차단. 등록 직후 mock 신원의 양방향(같은 인간/다른 인간) 동작을 **최우선 테스트**.
- **분류는 정규식, 집행은 SQL**: `matchTreasuryCommand()`를 `matchFamilySkill` 옆에
  (`respond.ts:385` seam, "돈 명령은 문장으로" 선례). 실행은
  `UPDATE … WHERE status='pending' RETURNING`으로 원자적. 승인 POST는 `{actionId}`만
  받고 approverKey는 서버가 결정 — 클라이언트 페이로드는 절대 권한이 아님.
- **규칙은 불릿 문법**(`- ₩100,000 이상: 2명 승인`) — md 표는 `readOkfSectionTexts`에서
  증발. Treasury Rules 섹션은 profile 메뉴에 넣지 않고(기록 LLM의 append 오염 방지)
  시드가 파일 생성 후 `sectionOkfPaths`에 직접 등록. 파싱 실패 = 실행 거부.
- **지갑**: 에이전트 키 발급 복원(8/3 제거됨) 후 **sepolia ETH native transfer만**
  (ERC20 미구현). 오늘 밤 펀딩+잔고 확인, 온체인 장면은 사전 녹화.
- **확정 컷**: Uniswap 스왑, MCP step-up(37h에 산술적 불가 — 디브리프에 설계로 서술,
  9/26 정오까지 앞서면 유일한 스트레치), agent dock 연동, ERC20, 크레덴셜 티어링.
  **컷 금지**: 거부 4경로(정책 위반/정족수 미달/부계정 바인딩 거절/미인증) — 트랙 요건.
- **디브리프는 hour-0부터 타임스탬프 로그** → IDKit/IdP 각 1부. 커밋은 작업 단위마다
  제출 리포(origin=relational-agents, 확인 완료)에 즉시.

### P0 — 확정 실행 순서 (총 ~30h, 크리티컬 패스 = 등록→배포→실IdP 검증→리허설)

0. **[완료] 즉시 조치** — dev DB에 `world_sub`/`world_verified_at`/`teamspace_drives.backup`
   수동 적용(health 200 복구), WIP 커밋. **[대기] vLLM(:8100) 복구 또는 AI_URL 폴백** —
   treasury 메시지는 전부 템플릿 폴백으로 설계해 모델 없이도 데모 성립.
1. **스키마 1회 push** — `treasuryActions`(id·roomId·kind·params·paramsHash·
   requiredApprovals·status) + `treasuryApprovals`(actionId·userId·approverKey·
   unique(actionId, approverKey)) 를 worldSub와 **같은 배포 단위로**.
2. **목 IdP**(authorize/token/jwks 3라우트, `WORLD_ISSUER` 스왑, **"같은 인간으로 두 계정
   로그인" 지원**) → **callback**(체크리스트: requireAuth / state / **시작-유저 쿠키
   `world_uid`==세션**(demo-login 전환 오바인딩 방지) / one-time 쿠키 삭제 / 23505→거절
   카드 / returnTo 재검증) + connect에 nonce·`max_age=0` 추가.
3. **지갑 키 복원**(lazy, spend.ts 경로 재활) + 펀딩.
4. **Treasury Rules 시드**(불릿 문법) + 결정적 파서(`lib/agent/treasury/policy.ts`).
5. **분류+게이트+거절**(기억 인용 카드, 템플릿 우선) — 공유 파일엔 훅 한 줄만, 신규
   로직은 `lib/agent/treasury/` 새 파일로 (팀원 병행 작업과 충돌 최소화).
6. **승인 흐름** — TreasuryApprovalBanner(consent-banner 복제) + `notifyConsent` 알림 +
   IDKit verify(action 화이트리스트 `{relation-consent, treasury-approval}`) + 정족수 +
   원자적 집행 + Treasury Activity(OKF `appendOkfLines`)/원장 기록.
7. **거부 4경로** + e2e check 1본.
8. **시드 완성**: Tokyo Trip 5인(데모 워크스페이스 멤버, displayName 유니크, consentAt
   스탬프, @agent 멘션 필요 유의) + 부계정 6번째 + 3인 사전 인증. `--reset` 재구성.
9. **프로드 배포 #1**(9/26 오전) → 실 IdP 왕복 검증 → 드라이런 → **17:00 피처 프리즈**
   → 배포 #2 → 위험 장면 3종(OIDC 왕복/온체인/시빌) 사전 녹화 → 라이브 장면(명령→승인
   →집행, 정책 위반 즉시 거절)과 함께 영상.

### P2 — 제품 확장 (문서 언급만)

- AINDrive 권한 부여를 같은 승인 흐름으로("돈과 데이터에 같은 정책"), x402, MCP step-up.

### W5 문서 — 데모 대본(3분, 호텔 엔딩, 라이브 vs 사전녹화 배치 포함) +
**integration debrief 2종**(hour-0 로그 기반: time-to-success/마찰 3개/최대 개선 1개) +
README(영어, pre-existing(7월 personhood) vs built-this-weekend 표) + 폼.

## 6. 남은 일 & 리스크

- [ ] **(사람, 오늘 밤 — hour-0 블로커)** ① Developer Portal staging app 생성 + action
      `treasury-approval`(max verifications **unlimited**) — IDKit 트랙은 이것 없이
      요건 1·2·4 시연 불가(dev-simulator는 IDKit이 아님) ② sandbox IdP 클라이언트 등록
      (20분 승인 창, redirect=`https://ainmem.ainetwork.ai/api/auth/world/callback`).
      등록 실패 시 Agents 트랙은 폴백 없음 — 최종 마감 9/26 오전.
- [ ] vLLM 복구/AI_URL 폴백, sepolia 펀딩 (에이전트가 오늘 밤)
- [ ] 데모 영상 육성 녹음 (사람, 9/26 저녁 — 세그먼트 촬영)
- 리스크: 마감 09-27 09:00 JST. 배포는 2회로 제한(버그당 배포 루프 방지 — 목 IdP로
  로컬 검증 후), 배포 불능 시 HTTPS 터널을 redirect로 추가 등록. 리허설은 반드시
  localhost/HTTPS(LAN IP는 Secure 쿠키 소실). 심사 중 IdP 가용성은 통제 불가 —
  제출물의 본체는 영상.
