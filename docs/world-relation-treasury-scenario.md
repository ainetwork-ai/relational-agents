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

## 5. 구현 계획 (Continuity: 기존 자산 위에)

재사용: 룸/멤버/채팅, **에이전트 지갑(이미 룸마다 발급됨 — 공동지갑 D)**, 원장 대시보드(카운터±색/차트), watcher 패턴, 서명·알림 플로우.
신규: ① sandbox OIDC 연동(/api/auth/world/*, sub 바인딩) ② Relation Policy(규칙) + 에이전트의 보호행동 분류 ③ 다중 승인 흐름(정족수=고유 sub 수) ④ 온체인 집행(송금+스왑) ⑤ 데모·디브리프 문서.

## 6. 남은 일 & 리스크

- [ ] sandbox 앱 등록 (world-id-agent-plugin / 포털 — 콜백 HTTPS 필요, 인터랙티브 로그인은 사람 필요)
- [ ] 데모 영상 육성 녹음
- 리스크: 마감 09-27 09:00 JST. 운용(스왑) 장면은 실시장 대신 포크/사전 시나리오로 고정 (변수 제거)
