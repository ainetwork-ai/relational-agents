# 노션(앱) 변경분 → ainmem 마이그레이션 노트 (2026-09-25, ETHGlobal 기간)

이 리포(relational-agents)는 ainmem에서 노션 기능을 가져와 머지한 상태에서
출발했고(2026-09 머지), 해커톤 기간에 **여기서 노션 앱에 추가한 것들을 다시
ainmem으로 옮길 때** 이 문서를 기준으로 옮긴다.

원칙: 아래 변경은 전부 **범용 제품 기능**이다. 트레이딩 전용 코드는 앱에 없다
(트레이딩은 `aqua/`가 데이터+뷰 설정으로 소비할 뿐이며, `aqua/`는 옮기지 않는다).

## 옮길 커밋 (이 순서대로 cherry-pick 권장)

| 커밋 | 제목 | 앱 쪽 파일 |
|---|---|---|
| `154d1d9` | counter number formatting | dashboard-view.tsx · db/schema.ts · i18n/en.ts · e2e/dashboard-counter.check.mjs |
| `cfaa1ac` | SSE refresh가 편집 중 뷰 설정 되돌리는 버그 수정 | database-block.tsx |
| `07e6b6c` | chart widget (line/candles + row markers) | dashboard-view.tsx · db/schema.ts · i18n/en.ts · e2e/dashboard-chart.check.mjs |
| `00d7fc1` | depth widget (two-sided cumulative step area) | dashboard-view.tsx · db/schema.ts · i18n/en.ts · e2e/dashboard-depth.check.mjs |
| `97ef6c3` | view PATCH가 `position` 허용 (랜딩 탭 제어) | api/databases/[databaseId]/views/[viewId]/route.ts |
| `57799d7` | (선택) guarded drizzle push 스크립트 | app/scripts/db-push.mts — 런타임 무관 개발 도구 |

커밋들이 `aqua/src/seed.js`도 같이 만졌으므로, cherry-pick 시 aqua 쪽 헝크는
버리면 된다 (ainmem에는 aqua가 없음).

## 변경 내용 요약 (충돌 시 손으로 옮길 때 기준)

### 1) DashWidget 타입 확장 — `app/src/lib/db/schema.ts`

DB 마이그레이션 **없음** — 위젯 설정은 기존 `db_views.config`(jsonb) 안이라
TypeScript 타입만 늘었다.

```ts
kind: ... | "chart" | "depth";      // 기존 counter/bar/donut/table/board/list에 추가
// counter
decimals?: number;                   // undefined = 자동(최대 2자리)
prefix?: string; suffix?: string;    // "$", " ETH" 등 리터럴 — 통화 enum 아님
colorBySign?: boolean;               // 양수 초록+선행 '+' / 음수 빨강
// chart(x=날짜)·depth(x=숫자 레벨)
xPropertyId?: string;
yPropertyId?: string;                // chart y축
chartType?: "line" | "candles";
bucket?: "hour" | "day" | "week";    // 캔들 OHLC 버킷
markerPropertyId?: string;           // select/status → 행마다 색 마커
// depth는 기존 groupByPropertyId(사이드)·aggregatePropertyId(크기) 재사용
```

### 2) `dashboard-view.tsx` — 렌더러/에디터

- `formatCounter()` + renderCounter의 부호색 클래스.
- `renderChart()`: 선 = 점 연결, 캔들 = 버킷별 OHLC 파생(같은 버킷 안 값들의
  시/고/저/종). **주의**: 캔들 모드는 x 도메인을 버킷 경계로 스냅한다 — 짧은
  버스트 데이터에서 버킷 중심이 캔버스 밖으로 나가는 버그를 이미 겪고 고쳤음.
- `renderDepth()`: select 첫 두 옵션으로 행을 갈라 좌측은 최고 레벨부터,
  우측은 최저 레벨부터 누적 계단 폴리곤. 크기 = 숫자 속성 합 또는 행 수.
- `PLOT_W` 맵: svg viewBox 폭을 위젯 너비(1~4)에 비례시켜 글자 크기 유지.
- 편집 모드 셀렉트: charttype/x/y/bucket/marker, depth의 레벨 축,
  counter의 decimals/prefix/suffix/±색 — 전부 `db-dashw-*` testid 부여됨.
- KINDS 목록·BODY 맵·widgetTitle·addWidget 기본값에 chart/depth 추가.

### 3) i18n 키 — `app/src/i18n/en.ts`

한국어 키 → 영어 값 컨벤션 그대로. 추가된 키:
`소수 자동` `소수 {n}자리` `접두어` `접미어` `±부호색` `차트` `{name} 차트`
`캔들` `시간별` `일별` `주별` `마커 없음` `{name} 마커`
`날짜 속성과 숫자 속성이 필요합니다.` `깊이` `{name} 축`
`숫자 속성과 옵션 2개 이상의 선택 속성이 필요합니다.`
(`선`은 이미 있었음 — 중복 추가하면 tsc가 TS1117로 잡는다.)

### 4) 뷰 편집 유실 버그 수정 — `database-block.tsx` (`cfaa1ac`)

`refreshSnapshot()`이 SSE 이벤트마다 `setViews(snap.views)`로 서버 사본을
통째로 덮어서, PATCH debounce(350ms) 안에 있던 뷰 설정 편집이 조용히
롤백됐다. `dirtyViewConfigs` ref(Map<viewId, config>)에 로컬 편집을 기록하고
자기 PATCH가 착지하면 지우며, refresh는 dirty한 뷰의 config를 보존한다.
**ainmem에도 동일 코드가 있다면 같은 버그가 있다** — 위젯 편집 e2e가 이걸로
플레이크났던 게 발견 경위.

### 5) 뷰 순서 API — `views/[viewId]/route.ts` (`97ef6c3`)

PATCH body에 `position?: number` 허용. position 최솟값 뷰가 페이지를 새로
열었을 때의 랜딩 탭(`views[0]`)이 된다. UI 변경 없음, API-only.

## 검증 방법 (옮긴 뒤 그대로 실행)

```bash
cd app
npx tsc --noEmit
BASE_URL=http://localhost:<port> node e2e/dashboard-counter.check.mjs
BASE_URL=http://localhost:<port> node e2e/dashboard-chart.check.mjs
BASE_URL=http://localhost:<port> node e2e/dashboard-depth.check.mjs
```

체크 3개는 각자 임시 DB를 만들어 새 컨트롤 전부를 실제로 누르고 지우고 나간다
(트레이딩 데이터 불필요). 전제: `POST /api/auth/demo-login`,
`POST /api/databases {shape:"minimal"}`, properties/views/rows/fullpage API —
ainmem에 이 표면이 다르면 체크 상단 `api()` 헬퍼만 손보면 된다.

## 옮기지 않는 것

- `aqua/` 전체 (1inch 파이프라인·시드·리뷰 에이전트) — 이 리포 전용.
- dev DB에 시드된 Swap Journal / Token DB / Trade review 페이지 — 데이터일 뿐.
- Tailwind v4 참고: e2e 색 검증은 computed color가 `lab()`으로 나와서
  a축 부호로 초록/빨강을 판정한다 (rgb 정규식 쓰면 실패).
