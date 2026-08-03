# 프로덕션 배포 — ainmem prod (`ainmem_prod`)

> 2026-07-25 첫 라이브 배포(memory.ainetwork.ai)에서 내린 결정과 그 이유로 시작한
> 문서다. 2026-07-30 이 프로젝트를 **v100-02 호스트로 가져와 ainmem prod로 새로
> 띄우면서** §1·§2·§4.3·§4.8·§5·§6을 이 호스트 기준으로 갱신했다. §3·§4의 결정과
> 함정은 호스트와 무관하게 유효해 그대로 둔다.
>
> **확정본이 아니라 이어받기 위한 기준점**이다. 결정된 것, 폐기된 것(과 그 이유),
> 아직 열린 것을 구분해 적었다. 새 세션은 §1로 현황을 잡고 §6(열린 질문)부터
> 이어가면 된다.

## 1. 지금 떠 있는 것

호스트 `v100-02`, 리포 `/home/comcom/ainmem`. 2026-07-30 기준.

| 항목 | 값 |
|---|---|
| URL | `https://ainmem.ainetwork.ai` — **설치 대기**: DNS A 레코드와 nginx 적용이 남았다 (§6-6) |
| nginx | conf 초안 `deploy/nginx/ainmem.ainetwork.ai.conf` (certbot 이전 스냅샷) |
| 앱 | 컨테이너 `ainmem_prod_app` (`ainmem_prod:app-<sha>`) → `127.0.0.1:3100` |
| DB | 컨테이너 `ainmem_prod_postgres`, DB/롤 `ainmem_prod` (포트 미공개) |
| 콘텐츠(OKF) | 호스트 바인드 마운트 `deploy/okf-content/` (프로젝트 안, gitignore) |
| 볼륨 | `ainmem_prod_pgdata`, `ainmem_prod_mdmirror` |
| compose | `docker-compose.prod.yml` (프로젝트명 `ainmem_prod`) |
| 시크릿 | `.env.prod` (600, `.env*` 룰로 gitignore) |
| LLM | **보류** — `.env.prod`에 후보만 주석으로 (§4.8) |
| 데이터 | 스키마 34테이블, 행 0 — 비어 있다 (§6-7) |

구조는 `(nginx 미구성) → 127.0.0.1:3100 → app 컨테이너 → postgres 컨테이너`다.

이름은 이 호스트 규칙(`ainteams_prod_*`, `ainmem_dev_postgres`)에 맞췄다. 처음엔
가져온 리포에 있던 `memory-live` 정체성(프로젝트·컨테이너·이미지·DB·볼륨)으로
띄웠는데, **ainmem prod는 그 스택과 이름 말고는 아무것도 공유하지 않는 별개
서비스**라 전부 개명했다. `docker ps` 한 줄에서 어느 서비스·어느 환경인지 읽혀야
한다. 개명 시점에 DB 행이 0이라 덤프 없이 `down -v` 후 재기동으로 끝났다 —
데이터가 쌓인 뒤엔 이 비용이 훨씬 커진다.

## 2. 배포 / 롤백

```bash
cd /home/comcom/ainmem
E=.env.prod
TAG=$(git rev-parse --short HEAD)

# 빌드 — HEAD 스냅샷에서 빌드한다. compose의 build 컨텍스트는 워크트리라서
# `compose build`를 쓰면 커밋 안 된 작업까지 이미지에 굽힌다(다른 세션이 편집
# 중일 수 있다). 라이브가 어느 커밋인지 태그로 특정되어야 롤백이 의미를 갖는다.
SNAP=$(mktemp -d) && git archive HEAD | tar -x -C $SNAP
set -o pipefail   # | tail 은 빌드 실패를 exit 0으로 삼킨다 (§4.2)
docker build -f $SNAP/app/Dockerfile -t ainmem_prod:app-$TAG \
  --build-arg NEXT_PUBLIC_RELATION_REGISTRY_ADDRESS= \
  --build-arg NEXT_PUBLIC_RELATION_REGISTRY_CHAIN_ID= $SNAP/app

# 스키마 — 손으로, 한 번씩 (§3.6). migrate 프로파일이라 up -d 에는 안 뜬다.
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml \
  --profile migrate run --rm migrator

# 기동
APP_TAG=$TAG docker compose --env-file $E -f docker-compose.prod.yml up -d app

# 롤백 — 이전 태그로 되돌린다 (소스만이 아니라 node_modules까지 그 시점 그대로)
APP_TAG=<이전-SHA> docker compose --env-file $E -f docker-compose.prod.yml up -d app

docker images ainmem_prod   # 되돌릴 수 있는 후보 목록

# 배포 후 검증 — curl은 API가 응답하는 것만 증명한다. 화면이 그려지는지는
# 실제 브라우저로 봐야 한다(읽기 전용, 라이브 데이터를 건드리지 않는다).
# PROD_URL 을 반드시 준다: 기본값이 memory.ainetwork.ai(다른 머신, §4.3)다.
cd app && PROD_URL=http://127.0.0.1:3100 npx playwright test -c playwright.prod.config.ts

# 스키마가 이 빌드에 못 미치면 503 (무엇이 없는지는 서버 로그와 pnpm db:check).
# -f 를 쓰면 안 된다: 400 이상에서 본문을 버리므로 "문제가 있을 때만" 아무것도
# 보이지 않는다. 상태코드를 직접 찍는다.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health

# 컨테이너 헬스체크도 같은 엔드포인트를 본다 — unhealthy 는 "프로세스가 죽었다"가
# 아니라 "스키마가 이 빌드에 못 미친다"까지 포함한다.
docker inspect -f '{{.State.Health.Status}}' ainmem_prod_app
```

`app/e2e-prod/prod-smoke.spec.ts`는 방문자가 보는 것을 검사한다 — 로그인 화면이
뜨는지, 방과 문서가 그려지는지, 콘텐츠 트리가 비어 있지 않은지, 업로드 에셋이
뜨는지. 전부 읽기 전용이다. **기존 `playwright.config.ts`를 프로덕션에 겨누면 안
된다** — 그건 자체 dev 서버를 띄우고 공유 DB를 쓰며, 데이터를 실제로 변경하는
스펙이 섞여 있다.

> 이 호스트에서는 아직 **통과할 수 없다.** DB가 비어 있어 검사할 계정도 방도
> 문서도 없다(§6-7). 데이터가 들어오기 전까지 배포 검증은 `/api/health` 200과
> 컨테이너 healthy까지다.

## 2.1 백업 / 복원

```bash
scripts/backup-prod.sh                # 기본값: 앱을 잠깐 pause, 14세트 보존
scripts/backup-prod.sh --no-pause --keep 30
COPY_TO=user@host:/path scripts/backup-prod.sh   # 호스트 밖 사본까지
```

한 세트는 `deploy/backups/<타임스탬프>/`에 `db.dump`(pg_dump -Fc),
`files.tar.gz`(okf-content·uploads·avatars), `MANIFEST`(커밋 SHA, 이미지 태그,
테이블·행 수, sha256)로 떨어진다. md-mirror는 파생물이라, `.env.prod`는 데이터와
같은 아카이브에 시크릿을 넣지 않기 위해 제외한다.

**순서가 곧 안전장치다.** DB 행이 OKF 경로와 업로드 URL을 가리키므로 두 시점이
어긋나면 참조가 깨진다. 스크립트는 항상 **DB → 파일** 순으로 뜬다: 그 사이 생긴
파일은 덤프에 없으니 고아로 남을 뿐 무해하고, 반대 순서면 DB가 없는 파일을 가리켜
깨진다. `--pause`(기본)는 그 틈마저 없앤다. 부작용이 하나 있다 — pause 동안
헬스체크가 돌지 못해 컨테이너가 잠시 `unhealthy`로 보인다. 다음 검사(30s)에서
스스로 복구되지만, 헬스 상태를 보고 반응하는 것이 생기면 이 깜빡임을 알고 있어야
한다.

복원은 이렇게 한다(prod를 덮어쓰므로 손으로):

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop app
docker exec -i ainmem_prod_postgres psql -U ainmem_prod -d postgres \
  -c 'drop database ainmem_prod' -c 'create database ainmem_prod'
docker exec -i ainmem_prod_postgres pg_restore -U ainmem_prod -d ainmem_prod \
  --no-owner --no-acl < deploy/backups/<타임스탬프>/db.dump
tar xzf deploy/backups/<타임스탬프>/files.tar.gz -C deploy
docker run --rm -v "$PWD/deploy:/d" alpine chown -R 1001:1001 /d/okf-content /d/uploads /d/avatars
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d app
```

`MANIFEST`의 `git_commit`이 지금 코드와 다르면 스키마도 다를 수 있다 — 복원 후
`/api/health`가 503이면 그 이야기다(§3.6).

2026-07-30에 빈 DB로 한 바퀴 검증했다: 일회용 postgres 컨테이너에 `db.dump`를
복원해 34테이블이 그대로 올라오는 것, `files.tar.gz`가 세 디렉터리를 담고 있는 것,
pause된 앱이 스크립트 종료 후 반드시 unpause되는 것(트랩)을 확인했다.

## 3. 결정된 것과 그 이유

### 3.1 Docker — systemd + 파일 복사를 폐기하고 채택

처음엔 리포에 Dockerfile이 없어서 systemd + rsync 사본으로 띄웠다. **폐기했다.**
git이 없는 파일 더미라 라이브에 뭐가 떠 있는지 커밋으로 특정할 수 없고 롤백이 불가능했다.
첫 배포 호스트의 `aindrive`가 이미 커밋 SHA로 태깅한 이미지(`predeploy-88e1755`)를
남기는 방식으로 도는 걸 보고 그 관례를 따랐다. git worktree 방식도 검토했으나 소스만
되돌릴 뿐 `node_modules`까지 되돌려주지 않아 이미지 태깅이 낫다. v100-02에서도
`ainmem_prod:app-<sha>`로 유지한다 — 이 호스트의 `ainteams_prod:web`은 SHA 없이
고정 태그라 롤백 후보가 남지 않는데, 그 관례는 따르지 않았다.

### 3.2 OKF 콘텐츠는 이미지가 아니라 바인드 마운트

`okf-store.ts`가 런타임에 `writeFileSync`/`mkdirSync`로 콘텐츠를 쓴다 — 폴더 트리가 곧
콘텐츠 DB다. 이미지에 구우면 **재배포마다 라이브에서 쌓인 문서가 날아간다.**
named volume 대신 호스트 바인드 마운트를 쓴 이유는 라이브에서 생성된 문서를 직접 열어보고
git으로 회수할 수 있어야 해서다. 컨테이너가 uid 1001로 돌기 때문에 마운트 경로는
`chown -R 1001:1001`이 되어 있어야 쓰기가 된다.

### 3.3 프로덕션 DB는 별도 컨테이너, 포트 미공개

dev는 이 호스트에서 `ainmem_dev_postgres`(5434, DB/롤 `notion_clone`)를 쓴다. 초기엔
라이브도 같은 DB를 봤는데, dev에서 `drizzle-kit push` 한 번이면 라이브 스키마가 그
자리에서 바뀌는 구조라 분리했다. 프로덕션 DB는 **포트를 공개하지 않는다** — dev
도구가 실수로 접근할 경로 자체를 없앤 것이다. DB·롤 이름도 `ainmem_prod`로 달라서
접속 문자열이 섞일 여지가 없다(값은 compose에 박지 않고 `.env.prod`의
`POSTGRES_DB`/`POSTGRES_USER`에서 온다. 빠뜨리면 `:?required` 가드가 기동 전에
멈춘다).

첫 배포에서는 초기 데이터를 dev DB에서 `pg_dump --no-owner --no-acl`로 떠서 넣었다
(롤 이름이 다르므로 `--no-owner`가 필수다). 이 호스트에서는 아직 넣지 않았다.
넣을 때 **DB만 옮기면 안 된다** — 행이 가리키는 OKF 경로가 `deploy/okf-content/`에
없으면 가리키는 문서가 없는 행만 남는다. 파일 트리도 같이 복사해야 정합이 맞는다.

### 3.4 compose 파일 분리

`docker-compose.prod.yml`은 별도 파일이고 프로젝트명도 `ainmem_prod`로 다르다.
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
- **컨테이너 헬스체크** — `docker-compose.prod.yml`의 app 서비스가 같은
  `/api/health`를 본다(node 내장 fetch로 — 런너 이미지에 curl이 없다). 그래서
  `docker ps`의 unhealthy가 "프로세스가 죽었다"만이 아니라 "스키마가 이 빌드에
  못 미친다"까지 포함한다.

이게 없으면 증상이 이렇게 나온다: 배포는 성공하고, 며칠 뒤 어떤 요청 하나가
`column "call_id" does not exist`로 죽는다. 어느 배포부터 그랬는지는 아무도
모른다.

푸시는 `migrator` 서비스로 돈다 — `profiles: ["migrate"]`라서 `up -d`에는 절대
뜨지 않고 `--profile migrate run --rm migrator`로만 실행된다. 런타임 이미지에는
drizzle-kit도 스키마 소스도 없어서(standalone 번들) **builder 스테이지**를 쓴다.
레이어는 앱 빌드와 공유되므로 추가 비용이 없다.

## 4. 함정 — 여기서 시간을 썼다

### 4.1 프로덕션 빌드는 원래 깨져 있었다 (해소됨)

`next build`가 `/api/agent/[agentUserId]/spend`에서 `TypeError: Y is not a function`
(@noble/hashes sha3)으로 죽던 문제였다. AgentKit이 publish 시점에 선번들한 코드를
Turbopack이 다시 번들하면서 ESM interop이 깨진 것이 원인이었고,
`serverExternalPackages`에 `@coinbase/agentkit`을 넣어 우회했다. World 트랙(AgentKit
지불 데모)이 제거되면서 해당 라우트와 의존성이 함께 사라져 이 함정은 더 이상 없다.
`serverExternalPackages`에는 `viem`, `@ainblockchain/ain-js`만 남아 있다.

### 4.2 `| tail`이 빌드 실패를 exit 0으로 가린다

`next build ... | tail -40`은 종료 코드를 삼킨다. 실제로 실패한 빌드가 성공으로 보고돼
한참 헤맸다. **빌드/게이트 검증은 반드시 `set -o pipefail`.**

### 4.3 공인 IP는 egress ≠ ingress

`curl ifconfig.me`가 답하는 `103.139.119.10`은 **egress** IP다. DNS A 레코드가
가리켜야 하는 것은 **ingress**고, 둘은 다르다 — 이 서버는 NAT 뒤에 있다. 헷갈리면
certbot HTTP-01이 실패한다.

2026-07-30 v100-02에서 확인한 값:

| 이름 | 값 | 비고 |
|---|---|---|
| egress (`ifconfig.me`) | `103.139.119.10` | 첫 배포 호스트와 같다 — 같은 NAT |
| `ainteams.ainetwork.ai` | `101.202.37.107` | 이 호스트의 nginx가 서브한다 → 이게 **이 호스트의 ingress** |
| `memory.ainetwork.ai` | `101.202.37.14` | `aindrive.ainetwork.ai`와 같다 = **다른 머신** |
| `ainmem.ainetwork.ai` | (레코드 없음) | |

즉 **`memory.ainetwork.ai`는 이 스택을 가리키지 않는다.** 그 이름은 첫 배포 호스트
(`.14`)에 그대로 남아 있다. 이 호스트의 ainmem prod에 도메인을 붙이려면 새 이름을
`101.202.37.107`로 향하게 하거나, `memory.ainetwork.ai`의 A 레코드를 옮겨야 한다
(그러면 저쪽이 죽는다 — 먼저 확인할 것). §6-6.

로컬 리졸버 부정 캐시 탓에 **이 호스트에서** 자기 도메인 curl이 000으로 죽는 일이
있는데 장애가 아니다. 그때는 ingress를 직접 지정한다:

```bash
curl --resolve <도메인>:443:101.202.37.107 https://<도메인>/login
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

### 4.8 컨테이너의 `localhost`는 호스트가 아니다 — 그리고 엔드포인트는 호스트마다 다르다

`AI_URL` 기본값 `localhost:8100`이 컨테이너 안에서는 자기 자신을 가리켜 모든 LLM
호출이 `ECONNREFUSED`로 죽었다. 로그에만 남고 결정론적 폴백으로 조용히 넘어가서
겉으로는 멀쩡해 보인다. 첫 배포 호스트에는 vLLM이 있어서
`host.docker.internal` + `extra_hosts: host-gateway`로 해결했다.

**v100-02에는 vLLM(:8100)이 없다.** 그런데 compose에 `AI_URL`이 하드코딩돼 있어서,
그 값이 이 호스트에서는 아무 데도 없는 곳을 가리켰다 — 같은 함정의 재발이다.
그래서 compose에서 뺐다. `AI_URL`/`AI_MODEL`/`AI_API_KEY`는 **런타임** 변수이므로
`.env.prod`에만 있고, 바꾸려면 재시작만 필요하다(재빌드·새 태그 불필요 — §4.9의
`NEXT_PUBLIC_*`와 정반대다). `host.docker.internal` 별칭은 남겨 뒀다.

현재는 **보류** 상태다. 후보 세 개(ainetwork 공용 `llm.ainetwork.ai/v1`,
Azure OpenAI, 호스트 로컬)를 `.env.prod` 주석에 적어 뒀다. Azure는 신형 v1 서피스
(`/openai/v1`)만 코드 수정 없이 맞는다 — 구형은 `?api-version=` 쿼리와 `api-key`
헤더를 쓰므로 `src/lib/ai/openai-compat.ts`를 손봐야 한다.

미설정 상태에서 실제로 일어나는 일(모두 확인함):

| 경로 | 동작 |
|---|---|
| 메모리 쓰기 `agent/pipeline.ts` | throw → catch → `fakeEdits`로 기록. 에러 로그 남음 |
| send-guard `agent/guard.ts` | throw → catch → 전송 허용. 에러 로그 남음 |
| AI 채팅 패널 `ai-chat.ts` | **catch 없음 → 화면에 에러** |

`AI_FAKE_LLM=1`로 켜는 선택도 있었지만 채택하지 않았다. 마지막 줄이 뒤집히는데 —
가짜 답변이 **진짜 답변처럼** 스트리밍되고 로그도 남지 않는다. 엔드포인트가 없으면
없는 대로 드러나는 편이 낫다. fake 플래그는 e2e/CI용이다.

### 4.9 `NEXT_PUBLIC_*`는 빌드타임, 서버는 런타임 — 반쪽만 켜면 침묵한다

Dockerfile이 선언한 ARG 중 일부만 compose가 넘기고 있었다. 빠진 값은 브라우저
번들에서 영원히 `undefined`인데 **서버는 같은 이름을 런타임에 읽는다.** 그래서
`.env.prod`에만 값을 넣고 재시작하면 서버와 브라우저가 서로 다른 상태를 믿게 되고,
그 불일치는 **로그 한 줄 없이** 기능을 죽인다. 지금은 Dockerfile의 ARG와 compose의
build args가 1:1로 맞아 있다. 값을 바꾸려면 재시작이 아니라 `build` + 새 `APP_TAG`가
필요하다.

### 4.10 한 번 저장된 값은 env를 바꿔도 따라오지 않는다

에이전트의 `a2a_url`과 `agent_card_json.url`은 provision 시점에 DB에 굳는다.
`A2A_BASE_URL`을 프로덕션 주소로 바꿔도 기존 8개 에이전트는 dev LAN 주소
(`http://192.168.1.193:36625/...`)를 계속 광고했다. 인앱 호출은 `dispatch.ts`의
느슨한 `url.includes("/api/a2a/")` 매칭 덕에 우연히 살아 있어서 더 안 보인다.
일회성 UPDATE로 정정했다.

## 5. dev ↔ prod 격리 현황

| 자원 | 상태 |
|---|---|
| 소스 / `node_modules` / 빌드 | **분리** — HEAD 스냅샷에서 빌드, 이미지 안에서 clean install |
| Postgres | **분리** — 별도 컨테이너(`ainmem_prod_postgres`) + 별도 볼륨 + 별도 DB·롤 이름 |
| OKF 콘텐츠 | **분리** — 바인드 마운트 (단, git으로 자동 회수되지 않음) |
| 포트 | **분리** — prod 3100, dev 36625 / dev DB 5434 |
| 포트 대역 | 이 호스트 규칙: **ainteams 30xx, ainmem 31xx**. `ss -tlnp` 한 줄로 어느 서비스인지 읽힌다 |
| `SESSION_SECRET` | **분리** — 라이브 전용 값 |
| 온체인 키 (`DEPLOYER_KEY`) | **미설정** — 양쪽 다 키가 없어 온체인 릴레이는 비활성 |
| LLM | **해당 없음** — 이 호스트에 vLLM이 없고 prod는 보류 상태(§4.8) |

같은 호스트의 다른 서비스(`ainteams_prod_*`, `ainteams_staging_*`)와도 포트·DB·볼륨이
전부 다르다. 겹치는 자원은 없다.

## 6. 열린 질문

1. **온체인 키.** 이 호스트에는 `RELAYER_KEY`/`DEPLOYER_KEY`가 없어 온체인 릴레이가
   비활성이다(`relation-registry.ts`가 키 없으면 `null` 반환). 필요해지면 **라이브 전용**
   키와 자금을 넣어야 한다 — dev와 공유하면 동시 트랜잭션에서 nonce가 충돌한다.
2. **OKF 회수 정책.** 라이브가 쓴 문서는 바인드 마운트에만 쌓이고 git에 안 돌아온다.
   주기적으로 커밋할지, 버릴지 정해야 한다.
3. **`ENABLE_DEMO_LOGIN=1`.** 누구나 DemoUser로 로그인된다. 지금은 루프백 전용이라
   접근 경로가 없지만, **nginx로 공개하기 전에 다시 판단해야 한다.**
4. **origin/main 히스토리 재작성.** 2026-07-25 01:35 UTC `18084c0` 직후 GitHub 웹 UI
   업로드 커밋을 rebase로 통합하면서 179개 커밋의 SHA가 새로 찍혔다. 로컬 main이
   origin/main의 내용상 상위 집합(+ call 작업 10개)이라 `push --force-with-lease` 한 번이면
   정리되지만, 히스토리 재작성이라 합의가 필요하다. 배포 브랜치는 그 다음에 따는 게 깔끔하다.
5. **백업 스케줄.** 스크립트는 있다(§2.1) — 언제 자동으로 돌릴지와 호스트 밖
   사본을 어디에 둘지가 남았다. 지금은 손으로만 돈다. `deploy/backups/`는 원본과
   **같은 디스크**라 실수(`down -v`, 파일 삭제)에는 강하지만 디스크 손실에는 같이
   죽는다. 참고로 이 호스트에는 아직 자동 백업이 하나도 없다 — `~/backups/`,
   `~/db-backups/`의 ainteams 덤프도 전부 수동이고 `crontab -l`은 비어 있다.
6. **도메인 / nginx — 이름은 `ainmem.ainetwork.ai`로 정했다. 적용이 남았다.**
   `memory.ainetwork.ai`는 다른 머신(`101.202.37.14`)이라 쓰지 않는다(§4.3).
   conf 초안은 `deploy/nginx/ainmem.ainetwork.ai.conf`에 있고 nginx 컨테이너로
   문법 검증까지 했다. 남은 두 가지:
   - **DNS**: `ainmem.ainetwork.ai` A 레코드가 아직 없다(`dig` 무응답). 이 호스트의
     ingress `101.202.37.107`(= `ainteams.ainetwork.ai`와 동일)로 향해야 한다.
     레코드가 없으면 certbot HTTP-01이 실패한다.
   - **적용**: sudo가 필요해 사람이 실행한다.
     ```bash
     sudo cp deploy/nginx/ainmem.ainetwork.ai.conf \
        /etc/nginx/sites-available/ainmem.ainetwork.ai
     sudo ln -s /etc/nginx/sites-available/ainmem.ainetwork.ai \
        /etc/nginx/sites-enabled/ainmem.ainetwork.ai
     sudo nginx -t && sudo systemctl reload nginx
     sudo certbot --nginx -d ainmem.ainetwork.ai   # DNS 가 선 뒤에
     ```
   certbot이 live 설정에 TLS 블록을 넣는 순간부터 **live가 정본**이다. 그 뒤에
   `deploy/nginx/`의 초안을 다시 복사하면 HTTPS가 벗겨진다 —
   `~/NGINX-README.md`에 기록된 `setup-nginx.sh` 사고와 같은 함정이다.

   conf에 담긴 값과 근거: `client_max_body_size 12M`(=`/api/upload`의 10MB +
   multipart 오버헤드), `proxy_buffering off`(SSE 4곳 — AI 채팅 스트리밍,
   `dm/events`, `pages/[pageId]/events`. 버퍼링이 켜지면 토큰이 뭉쳐 오거나 응답이
   끝날 때까지 안 온다), `300s` 타임아웃(`/api/import`의 `maxDuration 300`과 LLM
   호출 타임아웃 120s를 덮는다).

   공개에 맞춰 `.env.prod`를 두 곳 바꿨다: `A2A_BASE_URL`을
   `https://ainmem.ainetwork.ai`로(§4.10 — DB가 비어 있는 지금이 공짜다), 그리고
   **`ENABLE_DEMO_LOGIN=0`**. 공개 URL에서 누구나 DemoUser로 들어오는 것을 기본값으로
   둘 수는 없다. MetaMask·키 로그인은 이 플래그와 무관하게 동작한다. 데모를 공개하려면
   `1`로 바꾸고 `up -d app`.
7. **초기 데이터.** DB는 스키마만 있고 행이 0이다. dev DB(5434 `notion_clone`)를
   덤프해 넣을지, 데모 로그인으로 새로 만들지 정해야 한다. 넣을 때 OKF 파일 트리를
   같이 복사해야 정합이 맞는다(§3.3).
8. **LLM 엔드포인트.** §4.8 참조. 결정되면 `.env.prod` 한 줄 + `up -d app`이면 끝이다.
