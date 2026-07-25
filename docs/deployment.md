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
| 콘텐츠(OKF) | 호스트 바인드 마운트 `/mnt/newdata/deploy/memory-live-content` |
| nginx | `/etc/nginx/sites-available/memory-live` |
| compose | `docker-compose.prod.yml` (프로젝트명 `memory-live`) |
| 시크릿 | `/mnt/newdata/deploy/memory-live.env` (600, git 밖) |

구조는 `nginx(443) → 127.0.0.1:3120 → app 컨테이너 → postgres 컨테이너`다.

## 2. 배포 / 롤백

```bash
cd /mnt/newdata/git/notion
E=/mnt/newdata/deploy/memory-live.env

# 배포 — 이미지를 커밋 SHA로 태깅해 라이브 버전을 특정 가능하게 만든다
TAG=$(git rev-parse --short HEAD)
docker compose --env-file $E -f docker-compose.prod.yml build app
docker tag memory-live-app:latest memory-live-app:$TAG
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml up -d app

# 롤백 — 이전 태그로 되돌린다 (소스만이 아니라 node_modules까지 그 시점 그대로)
APP_TAG=<이전-SHA> docker compose --env-file $E -f docker-compose.prod.yml up -d app

docker images memory-live-app   # 되돌릴 수 있는 후보 목록
```

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
