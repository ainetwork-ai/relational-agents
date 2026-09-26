# 시나리오 ↔ 구현 대조 (2026-09-26, xyz `1c7e0e4` 기준)

문제 정의: **함께 모은 돈에는 합의가 있는데, 지갑은 그 합의를 모른다.**
(*Shared money comes with an agreement. The wallet doesn't know it.*)

이 문서는 세 가지를 구분한다. ① 실제 구현된 것, ② 시나리오가 쓰는 것(대본 `DEMO.md` S0–S6과
구상 문서 `world_scenario.md`), ③ 둘 사이의 차이. 차이에 대한 **변경 제안은 마지막 절에만**
적고, 대본·기능은 이 문서로 바꾸지 않는다.

## 1. 구현된 것

| # | 기능 | 어디 | 시기 |
|---|---|---|---|
| I1 | 관계방 에이전트와 기억 문서(OKF 폴더, 페이지로 열람·편집) | `lib/agent/`, `okf-store.ts` | 기존(7월) |
| I2 | Treasury Rules 파서·평가기: 금액 구간, 종류(expense / investment / withdrawal / any), 정족수, "not allowed", "30% at once" | `lib/agent/treasury/policy.ts` | 신규 |
| I3 | 채택(ratify): 문서 편집은 제안, `@agent adopt` → 규칙이 정한 가장 엄한 정족수로 채택. 채택된 판만 효력 | `approvals.ts`, `memory.ts` | 신규 |
| I4 | 에이전트 지갑(Sepolia), 잔액, 송금(`transferUsd`), Etherscan 링크, 24h 만료, 실행 직전 재검사 | `wallet.ts`, `approvals.ts` | 신규 (AgentKit 래퍼는 기존) |
| I5 | 채팅 명령: `pay $X to <payee>`, `send $X to my wallet`, `invest $X of the idle funds`, status, adopt | `skill.ts` | 신규 |
| I6 | $50 미만 지출은 에이전트가 승인 없이 실행(시간당 한도 `TREASURY_AUTO_PER_HOUR`) | `approvals.ts` | 신규 |
| I7 | 투표권: IDKit World ID 4.0 Proof of Human, 액션 `treasury-seat`, 방마다 (사람, 방) 유일 인덱스 → 1인 1표 | `worldid-v4.ts`, `seat-button.tsx`, `treasury_seats` | 신규 (3.0 동의 배너는 기존) |
| I8 | 승인: World ID for Agents IdP step-up(`max_age=0`, `prompt=login`), 확인 페이지(금액·수취인·주소·규칙·현재 승인 수), pairwise sub로 사람 단위 정족수, `auth_time`이 요청 이후여야 함 | `auth/world.ts`, `api/auth/world/*`, `approvals.ts` | 신규 |
| I9 | 거부 경로: 규칙이 막는 요청은 투표 없이 거부, 같은 사람의 두 번째 계정 무효, 투표권 없음·오래된 증명·취소·외부인은 0표 | e2e 8/8 | 신규 |
| I10 | 투자 액션(`investment`): "Savings/Investments/idle funds"로 라벨된 수취인 주소로 **송금**. 규칙대로 3명 | `skill.ts`, `approvals.ts` | 신규 — **스왑 아님** |
| I11 | 개인 지갑 송금: 규칙에 "not allowed"면 요청 자체를 거부 | `policy.ts` | 신규 |
| I12 | Treasury Activity 자동 기록(결제·거부·승인자) | `memory.ts` | 신규 |
| I13 | 데모: 시드(`seed-tokyo-trip.mts`), 링크 로그인 `?as=&returnTo=`, e2e, mock IdP | `scripts/`, `e2e/` | 신규 |
| I14 | AINDrive: aindrive 로그인·드라이브 연결, 가족 공유 폴더를 에이전트가 읽고 찾음(레시피·녹음·사진), 파일 URL | `aindrive.ts`, `family-skills.ts` | 기존/9월 |
| I15 | x402: 선물(gift) — v2 exact, EIP-3009 USDC(Base Sepolia), 프로바이더 계층(가족 원장·aindrive), MetaMask 1 USDC 선물 | `lib/x402/*`, `gift.ts` | 9월 (공동지갑과 별개) |
| I16 | Family Vault(이자 붙는 타임캡슐) 데모 | README §Family Vault | 기존 데모 |
| I17 | Uniswap Family Passbook: 위임 서명(EIP-712) 안에서 USDC→WETH tsumitate, 패스북 JSON, `/learn` 페이지 | `uniswap/` | 병행 트랙, **Base 메인넷, 앱·공동지갑과 미연결** |

## 2. 시나리오가 쓰는 것

### 2a. 대본 `docs/world/DEMO.md` S0–S6

| 장면 | 쓰는 기능 | 상태 |
|---|---|---|
| S0 문제 | 방·패널 화면 | ✔ |
| S1 관계와 첫 투표 | I1 기억 문서, I2 규칙, I7 투표 | ✔ |
| S2 두 번째 계정 | I7 1인 1표 | ✔ |
| S3 호텔 보증금 $180 | I5, I2(2명), I8 확인 페이지·step-up, I4 송금, I12 기록 | ✔ 실측(승인 왕복 4.8초) |
| S4 같은 사람 두 계정 | I8 pairwise sub, I9 무효 | ✔ |
| S5 $700 내 지갑으로 | I11, I2(30%) | ✔ |
| S6 기록 | I12 | ✔ |

대본은 **구현된 것만** 쓴다. 투자·Uniswap·AINDrive·x402·업그레이드는 대본에 없다.

### 2b. 구상 문서 `world_scenario.md`

| 구상의 장면 | 구현 | 비고 |
|---|---|---|
| 관계 생성(방·에이전트·규칙 문서) | ✔ | 방·에이전트·문서는 UI, 지갑 충전은 스크립트 |
| 다섯 명 World 인증 | ✔ (I7) | "생성 시 한꺼번에"가 아니라 각자 투표권 받음 |
| 규칙: 소액 자동 / 중액 2명 / 대액 3명 / 개인 출금 | ✔ (I2, I6, I11) | 금액은 달러 |
| 매달 자동 적립 | ✘ | 미구현 |
| 여유 자금 투자, 3명 승인 | △ (I10) | **송금**으로 구현. 스왑·운용 없음 |
| 에이전트가 먼저 운용을 제안 | ✘ | 에이전트는 멤버 명령에만 반응. 선제 제안 없음 |
| Uniswap으로 온체인 실행 | ✘ 앱 / ✔ 별도 패키지(I17) | 공동지갑 지갑(Sepolia)과 패스북(Base 메인넷)은 다른 지갑·다른 체인 |
| 공동자금이 늘었다 | ✘ | 어떤 방법으로도 실연 불가(수익 보장 없음). 구상 문서도 "실시간 수익 증명은 피하라" |
| 더 좋은 호텔로 업그레이드 | △ | 결제 기능(I4·I8)으로 가능. 대본에 장면 없음 |
| A가 전부 출금 → 4명 승인 | ✔ 더 강함 | 개인 지갑은 불허, 30% 초과는 4명 |
| AINDrive 폴더 권한을 에이전트가 World 확인 후 부여 | ✘ | 읽기·공유(I14)는 있으나 "권한 부여" 명령과 World 게이트 없음 |
| x402로 자원 결제 | △ (I15) | 선물에만. 공동지갑과 무관 |

## 3. 차이 요약

1. **운용(투자)**: 시나리오는 "스왑·운용·수익"; 구현은 "라벨된 저축 수취인으로 송금". 수익은 실연 불가.
2. **에이전트 선제성**: 시나리오는 에이전트가 제안; 구현은 명령 대기.
3. **Uniswap**: 시나리오는 공동지갑의 온체인 행동; 구현은 별도 패키지·별도 지갑·메인넷.
4. **AINDrive·x402**: 시나리오는 같은 규칙이 데이터 권한·결제에도; 구현은 가족 데모의 읽기·선물에만.
5. **매달 적립**: 미구현.
6. **호텔 업그레이드**: 기능은 있고 장면이 없음.

## 4. 변경 제안 (미적용 — 결정 대기)

| # | 제안 | 필요한 것 | 소요 | 위험 |
|---|---|---|---|---|
| P1 | S3½ "여유 자금 맡기기": `invest $200 of the idle funds` → 3명 승인(창 3개) → 송금 → 컷: 패스북 페이지의 위임 매수 | 시드 Payees에 `Savings (idle funds): <패스북 에이전트 주소>` 1줄, 재시드, 팀원 화면 | 1h | 자막에 "pot는 테스트넷, 패스북은 메인넷, 수익은 예시" 명시 필요 |
| P2 | 투자 액션 승인 시 Base에서 Uniswap v3 스왑 실행, basescan tx 기록 | 브리지 코드, 에이전트 지갑에 Base USDC·가스, 실돈 시험 | 3–4h | 마감 전 팀원 패키지 수정·실돈 시험 |
| P3 | 엔딩 "hotel upgrade $150" 결제 장면(2명) | 대본만 | 30m | 없음(실제 Sepolia 송금 1건) |
| P4 | 에이전트 선제 제안("사용 예정 없는 $200이 있습니다") | 주기 작업 + 제안 카드 | 2–3h | 신규 코드 |
| P5 | AINDrive 권한 부여 장면(에이전트가 World 확인 후 폴더 권한) | 명령 + World 게이트 + aindrive 권한 API | 반나절+ | 신규 코드, aindrive 쪽 확인 필요 |
| P6 | x402 한 문장("같은 에이전트가 파일·자원 결제도") 클로징에 | 대본만 | 5m | 없음 |
| P7 | 인칭 "we"·실제 팀원 이름으로 표시명 | 시드 표시명 5개, e2e 기대값 | 20m | 본인 동의 |
| P8 | 매달 적립 | 미구현 — 대본에서 언급만 하거나 제외 | — | — |

권고 순서: P3·P6·P7(대본만) → P1(결정 시) → P2·P4·P5(마감 뒤 제품 로드맵).
