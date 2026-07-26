# 프로덕션 배포 — memory.ainetwork.ai

> 2026-07-25 첫 라이브 배포에서 내린 결정과 그 이유다. **확정본이 아니라 이어받기 위한
> 기준점**이다. 결정된 것, 폐기된 것(과 그 이유), 아직 열린 것을 구분해 적었다.
> 새 세션은 §1로 현황을 잡고 §6(열린 질문)부터 이어가면 된다.

## 1. 지금 떠 있는 것

| 항목 | 값 |
|---|---|
| URL | `https://memory.ainetwork.ai` |
| 인증서 | Let's Encrypt, certbot 자동 갱신 |
| 앱 | 컨테이너 `memory-live-app-1` → `127.0.0.1:3120` |
| DB | 컨테이너 `memory-live-postgres-1` (포트 미공개) |
| 콘텐츠(OKF) | 호스트 바인드 마운트 `deploy/okf-content/` (프로젝트 안, gitignore) |
| nginx | `/etc/nginx/sites-available/memory-live` |
| compose | `docker-compose.prod.yml` (프로젝트명 `memory-live`) |
| 시크릿 | `.env.prod` (600, `.env*` 룰로 gitignore) |

구조는 `nginx(443) → 127.0.0.1:3120 → app 컨테이너 → postgres 컨테이너`다.

## 2. 배포 / 롤백

```bash
cd /mnt/newdata/git/notion
E=.env.prod

# 배포 — 이미지를 커밋 SHA로 태깅해 라이브 버전을 특정 가능하게 만든다
TAG=$(git rev-parse --short HEAD)
docker compose --env-file $E -f docker-compose.prod.yml build app
docker tag memory-live-app:latest memory-live-app:$TAG
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml up -d app

# 롤백 — 이전 태그로 되돌린다 (소스만이 아니라 node_modules까지 그 시점 그대로)
APP_TAG=<이전-SHA> docker compose --env-file $E -f docker-compose.prod.yml up -d app

docker images memory-live-app   # 되돌릴 수 있는 후보 목록

# 배포 후 검증 — curl은 API가 응답하는 것만 증명한다. 화면이 그려지는지는
# 실제 브라우저로 봐야 한다(읽기 전용, 라이브 데이터를 건드리지 않는다).
cd app && npx playwright test -c playwright.prod.config.ts

# 스키마가 이 빌드에 못 미치면 503 (무엇이 없는지는 서버 로그와 pnpm db:check).
# -f 를 쓰면 안 된다: 400 이상에서 본문을 버리므로 "문제가 있을 때만" 아무것도
# 보이지 않는다. 상태코드를 직접 찍는다.
curl -s -o /dev/null -w '%{http_code}\n' https://memory.ainetwork.ai/api/health
```

`app/e2e-prod/prod-smoke.spec.ts`는 방문자가 보는 것을 검사한다 — 데모가 세계를
소유한 계정(`Chanho`)으로 열리는지, 방이 대화를 그리는지, OKF 트리가 비어 있지
않은지, 커버 에셋이 뜨는지. **기존 `playwright.config.ts`를 프로덕션에 겨누면 안
된다** — 그건 자체 dev 서버를 띄우고 공유 DB를 쓰며, 스펙 중에 관계를 실제로
해소하는 것들이 있다.

## 3. 결정된 것과 그 이유

### 3.1 Docker — systemd + 파일 복사를 폐기하고 채택

처음엔 리포에 Dockerfile이 없어서 systemd + rsync 사본으로 띄웠다. **폐기했다.**
git이 없는 파일 더미라 라이브에 뭐가 떠 있는지 커밋으로 특정할 수 없고 롤백이 불가능했다.
같은 호스트의 `aindrive`가 이미 커밋 SHA로 태깅한 이미지(`predeploy-88e1755`)를 남기는
방식으로 도는 걸 보고 그 관례를 따랐다. git worktree 방식도 검토했으나 소스만 되돌릴 뿐
`node_modules`까지 되돌려주지 않아 이미지 태깅이 낫다.

### 3.2 OKF 콘텐츠는 이미지가 아니라 바인드 마운트

`okf-store.ts`가 런타임에 `writeFileSync`/`mkdirSync`로 콘텐츠를 쓴다 — 폴더 트리가 곧
콘텐츠 DB다. 이미지에 구우면 **재배포마다 라이브에서 쌓인 관계 문서가 날아간다.**
named volume 대신 호스트 바인드 마운트를 쓴 이유는 데모 중 생성된 문서를 직접 열어보고
git으로 회수할 수 있어야 해서다. 컨테이너가 uid 1001로 돌기 때문에 마운트 경로는
`chown -R 1001:1001`이 되어 있어야 쓰기가 된다.

### 3.3 프로덕션 DB는 별도 컨테이너, 포트 미공개

dev는 `docker-compose.yml`의 `notion-clone-postgres-1`(5434)을 쓴다. 초기엔 라이브도
같은 DB를 봤는데, dev에서 `drizzle-kit push` 한 번이면 라이브 스키마가 그 자리에서
바뀌는 구조라 분리했다. 프로덕션 DB는 **포트를 공개하지 않는다** — dev 도구가 실수로
접근할 경로 자체를 없앤 것이다. 초기 데이터는 dev DB를 `pg_dump --no-owner --no-acl`로
떠서 넣었다(롤 이름이 `notion_clone` → `memory_live`로 다르다).

### 3.4 compose 파일 분리

`docker-compose.prod.yml`은 별도 파일이고 프로젝트명도 `memory-live`로 다르다.
개발 중 `docker compose up`이 라이브를 건드리는 일이 없어야 한다. 실행할 때
`-f docker-compose.prod.yml`을 명시해야만 뜬다.

### 3.5 배포 상태는 전부 프로젝트 안에 둔다

`.env.prod`, OKF 콘텐츠(`deploy/okf-content/`), DB 덤프(`deploy/backups/`) 모두
리포 안에 있다. 처음엔 시크릿을 git에서 떼어놓는다며 `/mnt/newdata/deploy/` 아래로
뺐다가 **되돌렸다.** `.gitignore`에 이미 `.env*`가 있어 리포 안에 둬도 커밋될 일이
없는데, 밖으로 빼면 배포 상태가 파일시스템 여기저기 흩어져 다음 사람이 찾지 못한다.
`/deploy/`는 gitignore에 추가했다 — 프로젝트 안에 있되 소스가 아니라 데이터다.

덕분에 compose의 경로도 절대경로가 아니라 `./deploy/okf-content`, `.env.prod`처럼
프로젝트 상대경로다. 리포만 있으면 배포가 재현된다.

### 3.6 스키마는 자동으로 밀지 않는다 — 대신 뜰 때 알려준다

`drizzle-kit push`는 손으로, DB 하나씩 돌린다. 부팅 때 자동으로 밀면 배포가
컬럼을 지우는 권한까지 갖게 되고, 아무도 그 diff를 읽지 않는다(3.3에서 dev와
라이브 DB를 분리한 이유와 같은 이야기다).

대신 읽기 전용 드리프트 검사를 세 곳에 뒀다. 셋 다 같은 함수를 부른다:

- **부팅 로그** — `src/instrumentation.ts`. 스키마가 맞으면 아무 말도 하지 않고,
  모자라면 없는 테이블·컬럼과 적용 명령을 한 블록으로 찍는다. 기동을 막지는
  않는다 — 컬럼 하나가 없다고 나머지 화면까지 못 열 이유는 없다.
- **`GET /api/health`** — 맞으면 200, 모자라면 **503**. 그게 전부다: 무엇이
  없는지는 본문에 담지 않는다. 인증이 없는 엔드포인트라 테이블·컬럼 목록이나
  드라이버 에러 문자열(`connect ECONNREFUSED <host>:5432`, DB 계정명)을 실으면
  묻는 사람 누구에게나 내부 지도를 건네는 셈이다. 세부는 서버 로그와
  `pnpm db:check` 로 — 고치는 사람은 이미 거기를 보고 있다.
- **`pnpm db:check`** — 아무 DB나 겨눠서 미리 확인. 모자라면 exit 1이라 게이트로
  쓸 수 있다.

이게 없으면 증상이 이렇게 나온다: 배포는 성공하고, 며칠 뒤 어떤 요청 하나가
`column "call_id" does not exist`로 죽는다. 어느 배포부터 그랬는지는 아무도
모른다.

## 4. 함정 — 여기서 시간을 썼다

### 4.1 프로덕션 빌드는 원래 깨져 있었다

`next dev`는 되는데 `next build`는 `/api/agent/[agentUserId]/spend`에서
`TypeError: Y is not a function`(@noble/hashes sha3)으로 죽었다. 트레이스에 뜨는
`viem@2.22.12`, `@noble+hashes@1.6.1`은 **이 트리에 존재하지 않는 버전**이라 디렉터리를
찾아도 없다 — AgentKit이 publish 시점에 선번들한 코드에 박힌 경로다. Turbopack이 그
선번들 코드를 다시 번들하면서 ESM interop이 깨진 것이라 재설치로는 안 고쳐진다.

→ `next.config.ts`의 `serverExternalPackages: ["@coinbase/agentkit", "viem", "@ainblockchain/ain-js"]`.

### 4.2 `| tail`이 빌드 실패를 exit 0으로 가린다

`next build ... | tail -40`은 종료 코드를 삼킨다. 실제로 실패한 빌드가 성공으로 보고돼
한참 헤맸다. **빌드/게이트 검증은 반드시 `set -o pipefail`.**

### 4.3 공인 IP는 egress ≠ ingress

`curl ifconfig.me`가 답하는 `103.139.119.10`은 **egress** IP다. DNS A 레코드가 가리켜야
하는 **ingress**는 `101.202.37.14`(`aindrive.ainetwork.ai`와 동일)다. 이 서버는 NAT
뒤에 있다. 둘을 헷갈리면 certbot HTTP-01이 실패한다.

부수 효과로 **이 호스트에서** `curl https://memory.ainetwork.ai`가 000으로 죽는데,
로컬 리졸버의 부정 캐시 때문이지 장애가 아니다. 검증은 이렇게 한다:

```bash
curl --resolve memory.ainetwork.ai:443:101.202.37.14 https://memory.ainetwork.ai/login
```

### 4.4 pnpm 24시간 격리 정책

pnpm 11은 최근 24시간 내 게시된 패키지를 거부한다(`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`).
리포 설정이 아니라 pnpm 기본값이다. 락파일이 frozen이고 각 항목에 sha512 무결성 해시가
있어 버전이 이미 고정·검증된 상태라, 이미지 빌드에서만
`--config.minimumReleaseAge=0`으로 해제했다. 켜두면 의존성이 하나 게시될 때마다
하루 동안 이미지 빌드가 막힌다.

### 4.5 pnpm 빌드 스크립트 승인이 이미지 빌드를 막는다

`app/pnpm-workspace.yaml`의 `allowBuilds:`에 21개 항목이
`set this to true or false` 플레이스홀더 그대로 남아 있다. 아무도 답하지 않은 상태라
strict 설치가 `ERR_PNPM_IGNORED_BUILDS`로 멈춘다. dev에도 컴파일된 `.node` 산출물이
하나도 없다(전부 순수 JS 폴백으로 돈다) — 그래서 이미지에서도 빌드 스크립트를 건너뛰는 게
dev와 **일치**시키는 선택이지 이탈이 아니다. `--config.strictDepBuilds=false`.

이어서 `pnpm exec next build`도 실행 전 의존성 상태 재검사에서 같은 검사에 다시 걸린다.
빌더 스테이지는 `node_modules/.bin/next build`로 바이너리를 직접 부른다.

> 근본 해결은 누군가 `pnpm approve-builds`로 21개 항목에 답하고 그 결과를 커밋하는 것이다.
> 그 전까지는 위 두 우회가 필요하다.

### 4.6 dev 서버가 prod 빌드를 덮어쓴다

`next.config.ts` 주석대로, 워크트리에서 `next build`를 하면 동시에 도는 dev 서버가
기본 `.next`를 덮어써 빌드를 날린다. Docker로 옮기면서 해소됐지만, 호스트에서 직접
빌드해야 할 일이 있으면 `NEXT_DIST_DIR=.next-prodcheck`로 격리할 것.

### 4.7 컨테이너에서 쓰는 경로는 전부 볼륨이어야 한다

이미지 안에 굽힌 런타임 쓰기 경로는 두 번 문제를 일으킨다. `COPY`가 root 소유로
넣으므로 uid 1001이 못 쓰고(EACCES), 설령 쓰더라도 재배포 때 통째로 사라진다.
`/api/upload`가 이걸로 500을 뱉었다. 현재 볼륨: OKF(`/data/okf`),
uploads·avatars(`/app/public/*`), md-mirror(`/data/md-mirror`).

`process.env.X ?? path.join(process.cwd(), ...)` 형태의 fallback이 세 곳
(`okf-store.ts`, `md-mirror.ts`, `workspace/export/route.ts`) 남아 있다.
env가 빠지면 컨테이너 안 존재하지 않는 경로로 조용히 흘러가고, md-mirror는
실패를 `catch`로 삼킨다. compose가 env를 넣고 있어 지금은 안전하지만,
**추적되지 않는 `docker-compose.yml`에는 `MD_MIRROR_ROOT`가 없다** — 그 파일로
배포하면 즉시 이 함정에 빠진다.

### 4.8 컨테이너의 `localhost`는 호스트가 아니다

`AI_URL` 기본값 `localhost:8100`이 컨테이너 안에서는 자기 자신을 가리켜 모든 LLM
호출이 `ECONNREFUSED`로 죽었다. 로그에만 남고 결정론적 폴백으로 조용히 넘어가서
겉으로는 멀쩡해 보인다. `host.docker.internal` + `extra_hosts: host-gateway`로 해결.

### 4.9 `NEXT_PUBLIC_*`는 빌드타임, 서버는 런타임 — 반쪽만 켜면 침묵한다

Dockerfile이 ARG 7개를 선언하는데 compose가 2개만 넘기고 있었다. 나머지 5개는
브라우저 번들에서 영원히 `undefined`인데 **서버는 같은 이름을 런타임에 읽는다.**
그래서 `.env.prod`에만 `NEXT_PUBLIC_HUMANBACKED_REGISTRY_ADDRESS`를 넣고 재시작하면
서버는 personhood 게이트를 켜고 브라우저는 World ID app id가 없어 nullifier를 못
만든다 → **consent가 영구 불가, 로그 한 줄 없음.** 지금은 7개 전부 전달한다.
값을 바꾸려면 재시작이 아니라 `build` + 새 `APP_TAG`가 필요하다.

### 4.10 한 번 저장된 값은 env를 바꿔도 따라오지 않는다

에이전트의 `a2a_url`과 `agent_card_json.url`은 provision 시점에 DB에 굳는다.
`A2A_BASE_URL`을 프로덕션 주소로 바꿔도 기존 8개 에이전트는 dev LAN 주소
(`http://192.168.1.193:36625/...`)를 계속 광고했다. 인앱 호출은 `dispatch.ts`의
느슨한 `url.includes("/api/a2a/")` 매칭 덕에 우연히 살아 있어서 더 안 보인다.
일회성 UPDATE로 정정했으나, **ENS 텍스트 레코드는 아직 옛 주소**다(§6).

## 5. dev ↔ prod 격리 현황

| 자원 | 상태 |
|---|---|
| 소스 / `node_modules` / 빌드 | **분리** — 이미지 안에서 clean install |
| Postgres | **분리** — 별도 컨테이너 + 별도 볼륨 |
| OKF 콘텐츠 | **분리** — 바인드 마운트 (단, git으로 자동 회수되지 않음) |
| 포트 | **분리** — 3120 (dev는 3000/3001) |
| `SESSION_SECRET` | **분리** — 라이브 전용 값 |
| 온체인 키 (`DEPLOYER_KEY`, 데모 지갑) | **공유** — 동시 트랜잭션 시 nonce 충돌 위험 |
| vLLM (`AI_URL`, :8100) | **공유** — 부하 경합만, 정합성 문제는 없음 |

## 6. 열린 질문

1. **온체인 키 분리.** dev와 live가 같은 `DEPLOYER_KEY`와 데모 지갑을 쓴다. 양쪽이
   동시에 트랜잭션을 쏘면 nonce가 충돌한다. 라이브 전용 키와 자금이 필요하다.
2. **OKF 회수 정책.** 라이브가 쓴 관계 문서는 바인드 마운트에만 쌓이고 git에 안 돌아온다.
   주기적으로 커밋할지, 데모용이라 버릴지 정해야 한다.
3. **`ENABLE_DEMO_LOGIN=1`.** 누구나 DemoUser로 로그인된다. 데모 목적이라 켰지만
   공개 URL이므로 인지하고 있어야 한다.
4. **origin/main 히스토리 재작성.** 2026-07-25 01:35 UTC `18084c0` 직후 GitHub 웹 UI
   업로드 커밋을 rebase로 통합하면서 179개 커밋의 SHA가 새로 찍혔다. 로컬 main이
   origin/main의 내용상 상위 집합(+ call 작업 10개)이라 `push --force-with-lease` 한 번이면
   정리되지만, 히스토리 재작성이라 합의가 필요하다. 배포 브랜치는 그 다음에 따는 게 깔끔하다.
5. **백업.** 프로덕션 DB 볼륨과 OKF 바인드 마운트에 대한 백업이 아직 없다.
   (`deploy/backups/`에 수동 스냅샷만 있다.)
6. **ENS 레코드가 옛 A2A 주소를 가리킨다.** DB는 §4.10에서 정정했지만 온체인
   `agent-endpoint[a2a]` 텍스트 레코드는 아직 `192.168.1.193:36625`다.
   8개 에이전트에 대해 재발행이 필요하고, 가스와 키가 든다.
7. **통화 STT가 꺼져 있다.** `NEXT_PUBLIC_CALL_WEB_SPEECH` 미설정이라 브라우저
   음성 인식이 항상 off고, 에이전트는 통화를 듣지 못한다(리캡은 100% 발화 기반).
   dev도 동일하므로 회귀는 아니지만, 데모에서 "에이전트가 통화를 듣는다"를
   보여줄 거라면 build arg로 `1`을 넘기고 재빌드해야 한다. 끌 거라면
   `call-view.tsx`의 "STT unavailable" 안내를 항상 노출하도록 바꿔야 한다.
8. **human-backed 결제가 전부 403이다.** World ID / humanbacked 레지스트리 주소가
   양쪽 다 미설정이라 `readIsHumanBacked()`가 무조건 false를 돌려주고
   `seller.ts`가 모든 지불을 거부한다. 켤지(빌드 arg + 런타임 env 동시) 끌지
   (`seller.ts` 게이트 완화) 정해야 한다. 이것도 dev와 동일 상태다.
