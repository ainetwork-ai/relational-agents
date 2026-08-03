# 프로덕션 배포 — ainmem prod (`ainmem_prod`)

> 2026-07-25 첫 라이브 배포(memory.ainetwork.ai)에서 내린 결정과 그 이유로 시작한
> 문서다. 2026-07-30 이 프로젝트를 **v100-02 호스트로 가져와 ainmem prod로 새로
> 띄우면서** §1·§2·§4.3·§4.8·§5·§6을 이 호스트 기준으로 갱신했고, 08-03에 도메인·TLS
> (§3.7), 구글 로그인(§3.8), 지갑·데모 제거(§3.9), General 팀스페이스(§3.10)를 더했다.
> 나머지 §3·§4의 결정과 함정은 호스트와 무관하게 유효해 그대로 둔다.
>
> **확정본이 아니라 이어받기 위한 기준점**이다. 결정된 것, 폐기된 것(과 그 이유),
> 아직 열린 것을 구분해 적었다. 새 세션은 §1로 현황을 잡고 §6(열린 질문)부터
> 이어가면 된다.

## 1. 지금 떠 있는 것

호스트 `v100-02`, 리포 `/home/comcom/ainmem`. 2026-08-03 기준.

| 항목 | 값 |
|---|---|
| URL | `https://ainmem.ainetwork.ai` — 라이브. Let's Encrypt(만료 2026-11-01, `certbot.timer` 자동 갱신), 80 → 301 (§3.7) |
| nginx | **정본** `/etc/nginx/sites-available/ainmem.ainetwork.ai` · `deploy/nginx/…conf`는 설치 전 스냅샷일 뿐이다 (§3.7) |
| 앱 | 컨테이너 `ainmem_prod_app` (`ainmem_prod:app-<sha>`) → `127.0.0.1:3100` |
| DB | 컨테이너 `ainmem_prod_postgres`, DB/롤 `ainmem_prod` (포트 미공개) |
| 콘텐츠(OKF) | 호스트 바인드 마운트 `deploy/okf-content/` (프로젝트 안, gitignore) |
| 볼륨 | `ainmem_prod_pgdata`, `ainmem_prod_mdmirror` |
| compose | `docker-compose.prod.yml` (프로젝트명 `ainmem_prod`) |
| 시크릿 | `.env.prod` (600, `.env*` 룰로 gitignore) |
| LLM | **보류** — `.env.prod`에 후보만 주석으로 (§4.8) |
| 로그인 | **구글 하나** (§3.8). 지갑·데모 로그인은 제거됨 (§3.9) |
| 데이터 | 스키마 32테이블. 사용자 1명, 워크스페이스 2개 — 라이브 사용 시작 |

구조는 `nginx(443, TLS 종료) → 127.0.0.1:3100 → app 컨테이너 → postgres 컨테이너`다.

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

# 백업 — cron(04:00)이 있어도 배포 전엔 손으로 한 번 뜬다. 마지막 자동 백업 이후
# 쌓인 것이 배포 사고로 날아가면 cron 이 있어도 잃는다 (§2.1).
scripts/backup-prod.sh

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
cd app && PROD_URL=https://ainmem.ainetwork.ai npx playwright test -c playwright.prod.config.ts

# 스키마가 이 빌드에 못 미치면 503 (무엇이 없는지는 서버 로그와 pnpm db:check).
# -f 를 쓰면 안 된다: 400 이상에서 본문을 버리므로 "문제가 있을 때만" 아무것도
# 보이지 않는다. 상태코드를 직접 찍는다.
curl -s -o /dev/null -w '%{http_code}\n' https://ainmem.ainetwork.ai/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health   # nginx 를 건너뛴 확인

# 컨테이너 헬스체크도 같은 엔드포인트를 본다 — unhealthy 는 "프로세스가 죽었다"가
# 아니라 "스키마가 이 빌드에 못 미친다"까지 포함한다.
docker inspect -f '{{.State.Health.Status}}' ainmem_prod_app
```

`app/e2e-prod/prod-smoke.spec.ts`는 방문자가 보는 것을 검사한다 — 로그인 화면이
뜨는지, 방과 문서가 그려지는지, 콘텐츠 트리가 비어 있지 않은지, 업로드 에셋이
뜨는지. 전부 읽기 전용이다. **기존 `playwright.config.ts`를 프로덕션에 겨누면 안
된다** — 그건 자체 dev 서버를 띄우고 공유 DB를 쓰며, 데이터를 실제로 변경하는
스펙이 섞여 있다.

> 이 호스트에서는 아직 **통과하지 못한다.** 스펙이 기대하는 방·문서·업로드가 없고
> (계정은 이제 있다), 로그인 방식이 구글로 바뀌어 스펙의 사인인 단계부터 다시 써야
> 한다(§6-8). 그때까지 배포 검증은 `/api/health` 200과 컨테이너 healthy까지다.

## 2.1 백업 / 복원

```bash
scripts/backup-prod.sh                # 기본값: 앱을 잠깐 pause, 14세트 보존
scripts/backup-prod.sh --no-pause --keep 30
scripts/backup-prod.sh --out /mnt/backup
COPY_TO=user@host:/path scripts/backup-prod.sh   # 호스트 밖 사본까지
```

자동 실행: **매일 04:00, 사용자 crontab.** 이 호스트 최초의 자동 백업이다(같은 호스트의
ainteams 는 릴리스 절차에 묶인 수동 덤프만 있고 cron 은 비어 있었다). 로그는
`~/ainmem-backups/cron.log` 에 append 되고, **그날의 `backup:` 줄이 없으면 실패한
것이다** — 스크립트가 판독 검증에 실패하면 세트를 지우고 exit 1 한다.

```cron
0 4 * * * /home/comcom/ainmem/scripts/backup-prod.sh >> /home/comcom/ainmem-backups/cron.log 2>&1
```

경로는 절대경로여야 한다 — cron 의 cwd 는 `$HOME` 이다. 등록 후 `env -i` 로 cron 과 같은
환경에서 한 번 돌려 확인했다.

**배포 직전에도 손으로 한 번 뜬다.** cron 은 바닥값이고, 배포는 되돌릴 지점이 필요한
순간이다 — 마지막 04:00 이후 쌓인 것이 배포 사고로 날아가면 cron 이 있어도 잃는다.
ainteams 의 릴리스 절차가 배포 전 덤프를 뜨는 것과 같은 이유다(§2 참조).

한 세트는 `~/ainmem-backups/<타임스탬프>/` 에 `db.dump`(pg_dump -Fc),
`files.tar.gz`(okf-content·uploads·avatars), `MANIFEST` 로 떨어진다. md-mirror 는
파생물이라, `.env.prod` 는 데이터와 같은 아카이브에 시크릿을 넣지 않기 위해 제외한다.

목적지는 **레포 밖**이다. 처음엔 `deploy/okf-content` 처럼 프로젝트 안에 뒀는데(§3.5),
백업만은 밖으로 뺐다 — `.gitignore` 는 실수를 줄이지만 `git add -f` 나 룰 변경 한 번에
무력화되고, 그때 커밋되는 것이 prod 사용자 데이터다. ainteams 도 `~/db-backups`,
`~/minio-backups` 로 같은 선택을 했다.

**순서가 곧 안전장치다.** DB 행이 OKF 경로와 업로드 URL을 가리키므로 두 시점이
어긋나면 참조가 깨진다. 스크립트는 항상 **DB → 파일** 순으로 뜬다: 그 사이 생긴
파일은 덤프에 없으니 고아로 남을 뿐 무해하고, 반대 순서면 DB가 없는 파일을 가리켜
깨진다. `--pause`(기본)는 그 틈마저 없앤다. 부작용이 하나 있다 — pause 동안
헬스체크가 돌지 못해 컨테이너가 잠시 `unhealthy`로 보인다. 다음 검사(30s)에서
스스로 복구되지만, 헬스 상태를 보고 반응하는 것이 생기면 이 깜빡임을 알고 있어야
한다.

**판독 검증.** `pg_dump` 의 exit 0 은 "쓰기가 실패하지 않았다" 이지 "읽을 수 있다" 가
아니다 — 디스크가 차거나 파이프가 끊기면 잘린 파일이 성공으로 남는다. 그래서 매번
`pg_restore -l` 로 TOC 를 파싱해 객체 수를 세고(현재 150), `tar tzf` 로 아카이브를
훑고, 둘 중 하나라도 실패하면 세트를 지운다. 읽히지 않는 백업을 보존 목록에 남기면
롤백 후보가 있다고 착각하게 된다. ainteams 릴리스 스킬의 함정 ⑥ 과 같은 태도다.

복원은 이렇게 한다(prod를 덮어쓰므로 손으로):

```bash
B=~/ainmem-backups/<타임스탬프>
docker compose --env-file .env.prod -f docker-compose.prod.yml stop app
docker exec -i ainmem_prod_postgres psql -U ainmem_prod -d postgres \
  -c 'drop database ainmem_prod' -c 'create database ainmem_prod'
docker exec -i ainmem_prod_postgres pg_restore -U ainmem_prod -d ainmem_prod \
  --no-owner --no-acl < $B/db.dump
tar xzf $B/files.tar.gz -C deploy
docker run --rm -v "$PWD/deploy:/d" alpine chown -R 1001:1001 /d/okf-content /d/uploads /d/avatars
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d app
```

`MANIFEST`의 `git_commit`이 지금 코드와 다르면 스키마도 다를 수 있다 — 복원 후
`/api/health`가 503이면 그 이야기다(§3.6).

2026-07-30에 빈 DB로 복원까지 한 바퀴 검증했다: 일회용 postgres 컨테이너에 `db.dump`를
복원해 테이블이 그대로 올라오는 것, `files.tar.gz`가 세 디렉터리를 담고 있는 것,
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

`.env.prod`, OKF 콘텐츠(`deploy/okf-content/`) 는 리포 안에 있다. **백업만은
예외로 밖에 둔다**(`~/ainmem-backups`, §2.1) — 다른 배포 상태는 잘못 커밋돼도 설정이
새는 정도지만, 백업은 prod 사용자 데이터 전체다. 처음엔 시크릿을 git에서 떼어놓는다며 `/mnt/newdata/deploy/` 아래로
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

### 3.7 도메인은 `ainmem.ainetwork.ai`, TLS는 certbot이 관리한다

2026-08-03 적용. `memory.ainetwork.ai`는 다른 머신(`101.202.37.14`)이라 쓰지 않았고
(§4.3), 새 이름을 이 호스트로 향하게 했다. DNS는 A가 아니라 **CNAME →
`ainteams.ainetwork.ai` → `101.202.37.107`** 로 들어갔다 — 동작에 문제는 없고
(certbot HTTP-01도 CNAME을 따라간다) ainteams의 IP가 바뀌면 같이 따라간다.

설치는 `deploy/nginx/ainmem.ainetwork.ai.conf`(HTTP 전용 초안)를 넣고
`certbot --nginx --redirect`를 돌리는 순서였다. certbot이 443 블록과 인증서 경로,
80 → 301 리다이렉트를 live 설정에 직접 써 넣는다. **그 순간부터
`/etc/nginx/sites-available/ainmem.ainetwork.ai`가 정본**이고, `deploy/nginx/`의
초안은 설치 전 스냅샷일 뿐이다. 다시 복사하면 HTTPS가 벗겨진다 —
`~/NGINX-README.md`에 기록된 `setup-nginx.sh` 사고와 같은 함정이라 초안 헤더에도
적어 뒀다.

conf 값의 근거: `client_max_body_size 12M`(=`/api/upload`의 `MAX_BYTES` 10MB +
multipart 오버헤드. 기본값 1M이면 사진 업로드가 nginx 단에서 413으로 잘린다),
`proxy_buffering off`(SSE 4곳 — AI 채팅 스트리밍, `dm/events`,
`pages/[pageId]/events`. 버퍼링이 켜지면 토큰이 뭉쳐 오거나 응답이 끝날 때까지
안 온다), `300s` 타임아웃(`/api/import`의 `maxDuration 300`과 LLM 호출 타임아웃
120s를 덮는다), `X-Forwarded-Proto`를 포함한 프록시 헤더 5종(빠지면 앱이 자기
주소를 http로 만들어 리다이렉트가 틀어진다).

공개에 맞춰 `.env.prod`의 `A2A_BASE_URL`을 `https://ainmem.ainetwork.ai`로 바꿨다
(§4.10 — DB가 비어 있는 동안은 공짜다). 데모 로그인은 공개 직후 `0`으로 껐다가,
곧이어 **로그인 경로 자체를 코드에서 들어냈다**(§3.8).

인증서는 `2026-11-01` 만료, `certbot.timer`가 자동 갱신한다. 갱신이 조용히 실패하는
경우를 대비해 만료 전에 한 번은 `sudo certbot renew --dry-run`으로 확인해 둘 것.

### 3.8 로그인은 구글 하나

2026-08-03. 있던 경로는 셋이었다: 데모 로그인(누구나 `DemoUser`), MetaMask 서명,
AIN 개인키 붙여넣기. 전부 걷어내고 **구글 로그인 하나로** 바꿨다.

구현은 서버 사이드 **인가 코드 플로우**를 직접 썼다. 라이브러리(Auth.js 등)를 넣지
않은 이유는 이 앱이 이미 세션을 소유하고 있어서다(`iron-session`) — 필요한 것은
리디렉트 두 번과 토큰 교환 한 번이고, 프레임워크는 세션 관리를 가져가면서 그 이상을
주지 않는다. 덤으로 콜백 경로도 우리가 정한다(`/api/auth/google/callback`; Auth.js를
쓰면 `/api/auth/callback/google`로 고정된다).

- `GET /api/auth/google/start` — state를 세션에 넣고 구글로 302. 로그인 버튼은
  `fetch`가 아니라 `<a>` 링크라, 사인인에 클라이언트 JS가 한 줄도 필요 없다.
- `GET /api/auth/google/callback` — state 대조(성공·실패 무관하게 1회용으로 소각)
  → 코드 교환 → 계정 조회/생성 → 세션 발급 → 홈.

**id_token 서명은 검증하지 않는다.** 우리 서버가 클라이언트 시크릿으로 인증해
구글 토큰 엔드포인트에서 TLS로 직접 받아온 값이라 중간에 손댈 주체가 없다(구글도
코드 플로우에 한해 이 생략을 문서화한다). 대신 그 보장이 덮지 못하는 것은 전부
검사한다: `aud`가 우리 클라이언트인지, `iss`가 구글인지, `exp`가 안 지났는지.
그리고 `email_verified`가 false면 거부한다 — 미인증 주소를 정체성으로 삼으면 진짜
주인이 나중에 로그인했을 때 남의 계정에 들어가게 된다.

계정 매칭은 **`sub` 우선, 이메일 폴백**이다. 이메일은 바뀔 수 있어서 그것만 키로
쓰면 같은 사람이 남남이 된다. 폴백이 있는 덕에 `page_invites`(이메일 초대)로 만들어진
행이 첫 구글 로그인에 흡수된다 — 그 초대는 `users`에 이메일이 없던 동안 매칭 상대가
아예 없었다.

스키마: `users`에 `google_sub`·`email`(둘 다 nullable UNIQUE)이 생기고
`ain_address`·`encrypted_private_key`는 사라졌다(§3.9). 브라우저가 구글에 직접
요청하지 않으므로 OAuth 클라이언트에 **JavaScript 원본은 필요 없다** — 리디렉션
URI만 있으면 되고, 그 값은 `GOOGLE_REDIRECT_URI`와 한 글자도 달라선 안 된다.

dev 포트를 **3110**으로 고정한 것도 이 때문이다(`next dev -p 3110`). 자동 할당
포트로는 리디렉션 URI를 등록해둘 수가 없다. 원격 호스트에서 개발할 때는
`ssh -L 3110:localhost:3110 …`로 터널을 열어야 한다 — 구글은 http를 `localhost`에만
허용하고 문자열을 그대로 비교하므로 LAN IP나 `127.0.0.1`은 다른 출처다.

### 3.9 지갑과 데모는 제거했다

2026-08-03. 서명할 주체가 사라진 뒤 지갑 위에 얹혀 있던 것 전부(약 1,700줄):
서명·검증 라이브러리(`lib/wallet/*`), 브라우저 프로바이더 훅과 버튼,
consent·dissolve 라우트, EIP-712 타입 빌더, `RelationalAgentRegistry` 온체인 릴레이,
그리고 `/wallet-sign-demo`. 마지막 것은 **공개 도메인에서 200으로 응답하면서 방문자에게
지갑 서명을 요구하는 페이지**였다 — 지갑 확장이 경고를 띄우는 바로 그 모양이라
남겨둘 이유가 없었다.

UI의 막다른 길 둘도 함께 사라졌다. DM의 consent·dissolve 배너는 버튼이 비활성인
채로 "Sign in with a wallet to sign"이라고 안내하고 있었다 — 아무도 따를 수 없는
지시다. 방 나가기도 서명을 요구하지 않는다.

동작이 바뀐 곳:

- **`chat_rooms.consent_at`을 방 생성 시 찍는다.** 예전엔 전원이 서명할 때까지
  `null`이었고, 지갑이 없어진 뒤로는 영원히 null이 될 상태였다. 컬럼은 남긴다 —
  "이 시점 이전 메시지는 메모리로 수집하지 않는다"는 기준선으로 아직 읽힌다.
- **에이전트가 키를 받지 않는다.** 생성된 AIN 키는 `encrypted_private_key`에 평문
  hex로 있었고, 마지막 독자는 `dispatch.ts`가 "키가 있으면 우리가 만든 에이전트"라는
  판별로 쓰던 것이었다. `a2aUrl`이 우리를 가리키는지가 그 사실을 직접 말한다.
- **외부 A2A 봇이 `ain_address`에 `a2a:<url>` 마커를 쓰지 않는다.** `a2a_url`과
  `a2a_id`가 이미 있다.

데모 픽스처도 같이 제거했다: `demo-cast`/`seed-demo-room`/`demo-ask` 스크립트,
sunset 시더와 그 라우트, 페르소나 홈 커버, `package.json`의 `demo:*` 스크립트.
`viem`과 `@ainblockchain/ain-js`는 마지막 import를 잃어 `serverExternalPackages`
항목과 함께 의존성에서 빠졌다(락파일 981줄, 패키지 115개 감소).

DB에서 지운 것: `relation_contracts`·`relation_dissolves` 테이블(두 DB 모두 0행이었다),
`users.ain_address`, `users.encrypted_private_key`.

### 3.10 새 워크스페이스는 General 팀스페이스와 함께 시작한다

빈 Teamspaces 섹션은 초대가 아니라 고장으로 읽힌다. 워크스페이스를 만드는 경로가
둘(첫 로그인의 `ensureWorkspace`, 스위처의 `POST /api/workspaces`)이라 공용 헬퍼
`ensureGeneralTeamspace()`를 양쪽에서 부른다. 이름 기준 멱등이라 두 번 불려도 하나만
남는다. 이 규칙이 붙기 전에 만들어진 워크스페이스 2개는 한 번의 INSERT로 채웠다 —
코드는 소급 적용되지 않는다.

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
(그러면 저쪽이 죽는다). 실제로는 새 이름을 CNAME으로 붙였다 — §3.7.

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

### 4.11 `req.url`은 컨테이너의 바인드 주소다

구글 로그인이 성공한 직후 브라우저가 **`https://0.0.0.0:3000/`** 으로 갔다. 지갑
확장이 피싱 경고를 띄웠는데, 그 판단은 맞다 — 정상 사이트는 그런 주소로 보내지
않는다. 원인은 콜백의 마지막 한 줄이었다:

```ts
NextResponse.redirect(new URL("/", req.url))   // req.url = http://0.0.0.0:3000/...
```

컨테이너는 `HOSTNAME=0.0.0.0 PORT=3000`으로 바인딩되고, standalone 서버의 `req.url`은
프록시가 넘긴 `Host`가 아니라 그 바인드 주소를 담는다. 로그인 자체는 이미 성공한
상태였다(계정·세션·워크스페이스 생성 완료) — 마지막 리다이렉트만 틀렸다는 점이
디버깅을 헷갈리게 한다.

고친 방법은 **`GOOGLE_REDIRECT_URI`의 origin을 기준으로 삼는 것**이다. 그 값은 구글이
콘솔 등록값과 한 글자 단위로 검증하므로 정의상 이 앱의 공개 origin이고, 프록시 헤더
(`X-Forwarded-Host`)를 신뢰하지 않아도 된다. 앱에서 요청으로부터 절대 URL을 만드는
곳은 여기뿐이라는 것도 확인했다.

## 5. dev ↔ prod 격리 현황

| 자원 | 상태 |
|---|---|
| 소스 / `node_modules` / 빌드 | **분리** — HEAD 스냅샷에서 빌드, 이미지 안에서 clean install |
| Postgres | **분리** — 별도 컨테이너(`ainmem_prod_postgres`) + 별도 볼륨 + 별도 DB·롤 이름 |
| OKF 콘텐츠 | **분리** — 바인드 마운트 (단, git으로 자동 회수되지 않음) |
| 포트 | **분리** — prod 3100, dev 3110(고정, §3.8) / dev DB 5434 |
| 포트 대역 | 이 호스트 규칙: **ainteams 30xx, ainmem 31xx**. `ss -tlnp` 한 줄로 어느 서비스인지 읽힌다 |
| `SESSION_SECRET` | **분리** — 라이브 전용 값 |
| 구글 OAuth 클라이언트 | **공유** — 같은 클라이언트에 dev/prod 리디렉션 URI를 함께 등록. 계정 판별만 하고 데이터는 건드리지 않는다 |
| LLM | **해당 없음** — 이 호스트에 vLLM이 없고 prod는 보류 상태(§4.8) |

같은 호스트의 다른 서비스(`ainteams_prod_*`, `ainteams_staging_*`)와도 포트·DB·볼륨이
전부 다르다. 겹치는 자원은 없다.

## 6. 열린 질문

1. **OKF 회수 정책.** 라이브가 쓴 문서는 바인드 마운트에만 쌓이고 git에 안 돌아온다.
   주기적으로 커밋할지, 버릴지 정해야 한다.
2. **origin/main 히스토리 재작성.** 2026-07-25 01:35 UTC `18084c0` 직후 GitHub 웹 UI
   업로드 커밋을 rebase로 통합하면서 179개 커밋의 SHA가 새로 찍혔다. 로컬 main이
   origin/main의 내용상 상위 집합(+ call 작업 10개)이라 `push --force-with-lease` 한 번이면
   정리되지만, 히스토리 재작성이라 합의가 필요하다. 배포 브랜치는 그 다음에 따는 게 깔끔하다.
   **아직 push 하지 않았다** — 08-03 작업(구글 로그인, 지갑·데모 제거)은 전부 로컬
   `remove-hackathon-integrations` 브랜치에만 있다.
3. **호스트 밖 사본.** 매일 04:00 cron 은 돈다(§2.1). 남은 것은 `~/ainmem-backups`
   가 원본과 **같은 디스크**라는 점이다 — 실수(`down -v`, 파일 삭제)에는 강하지만 디스크
   손실에는 같이 죽는다. 목적지를 주면 `COPY_TO=user@host:/path` 한 줄로 붙는다.
4. **LLM 엔드포인트.** §4.8 참조. 결정되면 `.env.prod` 한 줄 + `up -d app`이면 끝이다.
   아직 미설정이라 AI 채팅 패널은 에러를 띄우고, 메모리 쓰기는 결정적 append로 폴백한다.
5. **관계 에이전트의 자리.** 지갑이 사라져 "양쪽이 서명해야 에이전트가 태어난다"는
   전제가 없어졌다(§3.9). 방을 만들면 `consent_at`이 즉시 찍히므로 에이전트는 초대만
   하면 생긴다. 이 기능을 이 형태로 유지할지, 더 걷어낼지, 다시 설계할지가 남았다.
   `README.md`는 아직 지갑·온체인 전제로 쓰인 서사 그대로다.
6. **`page_invites` 매칭 확인.** 구글 로그인이 붙으면서 `users.email`이 생겨 이메일
   초대가 처음으로 실제 매칭될 수 있게 됐다(§3.8). 아직 그 경로를 실제로 통과시켜
   본 적은 없다.
7. **`md-mirror/` 워킹 트리 잔재.** 리포에 데모 워크스페이스에서 나온 `.md` 12개가
   남아 있다(gitignore 대상이라 커밋에는 없다). 파생물이라 지워도 앱이 다시 만든다.
8. **e2e 로그인.** 남은 스펙 3개(CHAT-fix ×2, EMOJI ×1)는 세션이 필요해서
   `helpers.ts`의 `demoLogin()`이 `test.skip()`으로 건너뛴다. 구글 OAuth를 테스트에서
   실제로 통과시킬 수는 없으니, 세션 쿠키를 직접 굽는 테스트 전용 경로가 필요하다.
   `e2e-prod/prod-smoke.spec.ts`도 같은 이유로 사인인 단계를 다시 써야 한다.
