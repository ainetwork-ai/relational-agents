# 오브젝트 스토리지 이관 (진행 중)

파일 바이트를 앱 컨테이너 디스크에서 MinIO 로 옮기는 작업. ainteams 의 EPIC87/64 구조를
따르며, 두 서비스가 같은 계약을 쓰는 것이 목적이다.

## 왜

`public/uploads` 가 5GB 로 자라면서 백업이 매일 밤 그 트리를 통째로 압축했고, 일관성을
위해 앱을 **3분 10초 정지**시켰다. 앱 헬스체크는 `interval 30s / retries 3` 이라 약 90초면
unhealthy 가 되고, 워치독은 "얼어 있음"과 "고장"을 구분하지 못한다 — 그래서 2026-08-14 부터
**매일 04:01 프로덕션이 재시작**됐다(워치독 로그 21건 중 15건).

파일이 오브젝트 스토리지에 있으면 백업이 API 를 거친 오브젝트 미러가 되어 **정지가 필요
없다**. 나머지는 2MB 짜리 pg_dump 뿐이라 90초 근처도 가지 않는다.

## 데이터가 어떻게 나뉘나

| 층 | 무엇이 진실인가 | 잃으면 |
|---|---|---|
| MinIO | **바이트** — 키가 곧 내용의 SHA-256 (`files/<sha256>.<ext>`) | 복구 불가 |
| Postgres | **사실** — 누가·언제·어디에·무슨 이름으로 붙였나 | 파일은 남되 고아 |
| `thumbs/` | 없음(파생) | 다시 만들면 됨 |

키에 **파일 이름이 들어가지 않는다.** 같은 pdf 를 두 사람이 다른 이름으로 올리면 오브젝트는
하나, 이름은 DB 행에 각각. 이름을 키에 섞으면 dedup 이 깨진다.

pg_dump 는 `s3://` **경로 문자열**만 보존한다 — 바이트를 대신 지켜주지 않는다. **둘 다 떠야
하고 어느 하나로는 복원되지 않는다.**

## 바이트가 나가는 길

MinIO 포트는 **공개하지 않는다.** presigned URL 도 쓰지 않는다(캐시·채팅 로그로 새어나가고
접근 제어가 우리 손을 떠난다). 바이트는 앱의 프록시 라우트로만 나간다:

- `/api/files/[id]/download` — 언제나 `Content-Disposition: attachment`
- `/api/files/[id]/stream` — `isStreamableMedia` 를 통과한 미디어만 인라인
- `/api/files/key/files/<sha256>.<ext>` — **키 주소**. 댓글 첨부와 달리 `files` 행이 없는
  것들(블록 이미지·페이지 커버)의 문. 로그인만 하면 되는데, 이는 대체 대상인
  `/uploads/*`(**누구나** 접근)보다 강하다. 페이지별 권한까지 가려면 블록 자산에도 행이
  필요하고 그건 이관보다 큰 작업이다.

**클라이언트는 서빙 경로만 쥔다.** `/api/upload` 도 tus 완료 응답도 `url` 로
`/api/files/key/…`(이관 전엔 `/uploads/…`)를 주고, `s3://` 토큰은 서버 안에서만 산다 —
행이 필요하면 `storageRefFromClientUrl` 이 그 경로에서 토큰을 만든다(댓글 POST). 처음엔
tus 가 토큰을 그대로 돌려줘서 AI 채팅이 그걸 본문에 박고 있었다(렌더도 안 되고 키가
대화 기록에 남았다). DM 메시지 검증기와 에이전트의 사진 인식도 같은 두 모양을 받는다.

**이 두 갈래가 업로드 allowlist 의 html/svg 허용 근거다.** 지금은 그 역할을
`next.config.ts` 의 `/uploads/*` CSP sandbox + nosniff 가 하고 있고, 6단계에서 이쪽으로
넘어온다.

## 단계

- [x] **1. 스토리지 계층** — `app/src/lib/files/storage.ts`. MinIO 클라이언트, 키 규칙,
      `putFile/putStream/statFile/streamFile`, lazy bucket. `isStorageConfigured()` 가
      false 면(= MINIO_* env 없음) **모든 호출자가 지금의 디스크 경로 그대로**라 동작이
      바뀌지 않는다. `e2e/storage-layer.check.mjs` 가 키 규칙과 폴백을 고정한다.
- [x] **2. `files` 테이블 + 프록시 라우트** — 첨부가 1급 행이 됐다(`comment_id` cascade).
      `/api/files/[id]/download` 는 언제나 attachment, `/api/files/[id]/stream` 은
      `isStreamableMedia` 통과 미디어만. 두 라우트가 `s3://` 와 이관 전 `/uploads/` 를
      **둘 다** 읽으므로 5단계를 파일 단위로 나눠 할 수 있다. 아직 아무도 안 쓴다.
      `e2e/file-routes.check.mjs` 가 계약을 고정한다. 로컬 MinIO 는
      `docker-compose.local.yml`.
- [x] **3. tus 완료 훅에서 승격** — `finalize-upload.ts`. 스트리밍 해시(1GB 에서
      `arrayBuffer()` 는 성립하지 않는다) → `contentKey` → `statFile` 로 있으면 건너뜀.
      그 한 번의 조회가 **dedup 이자 멱등성**이다 — 같은 pdf 를 열 번째로 붙이는 사람은
      바이트를 하나도 쓰지 않고, 클라 재시도로 완료 훅이 다시 돌아도 안전하다.
      MinIO 미설정이면 예전 그대로 디스크로 옮긴다.
      `e2e/upload-promotion.check.mjs`(실제 MinIO 필요)가 넷을 고정한다: 키가 내용 해시 ·
      같은 바이트 다른 이름 = 오브젝트 1개 · 재실행 안전 · 미설정 시 디스크.
- [x] **4. 댓글 첨부를 `files` 행으로** — `comments.attachments` jsonb 를 걷어냈다.
      POST 가 댓글과 함께 `files` 행을 만들고, GET 은 **id 만** 실어 보낸다 —
      클라이언트는 스토리지 키를 쥐지 않고 `/api/files/<id>/{stream,download}` 로만
      바이트에 닿는다. 들어오는 url 은 우리 버킷의 `s3://` 이거나 이관 전 `/uploads/`
      파일명이어야 한다(프록시가 남의 것을 가져오게 만드는 시도 차단).
      prod 에 그 컬럼이 없던 덕에 실데이터 마이그레이션은 0 이었다.
- [x] **5. 이관 (dev 만)** — `scripts/migrate-uploads-to-storage.mjs`. 기본이 dry-run,
      `--apply` 로만 쓴다. **원본을 지우지 않고**(되돌리려면 DB 참조만 되돌리면 된다)
      **멱등**하다(이미 옮긴 참조는 건너뛰고 같은 바이트는 statFile 이 거른다).
      dev 결과: 참조 1,046건(covers 3 · blocks 1,043), 전송 4,369MB,
      **중복 711MB 자동 제거** — 내용 주소 방식의 실제 이득.
      참조 모양이 둘인 이유: 댓글 첨부는 `files` 행이 있어 **id** 로 부르고, 블록·커버는
      행이 없이 `content.url` 로 바로 렌더되므로 **키 주소 경로**를 그 자리에 넣는다.
      그래서 렌더러를 하나도 안 고쳤다.
      **prod 도 완료(2026-08-28)**: 참조 1,062건(covers 3 · blocks 1,059), 전송 4,459MB,
      **중복 711MB 제거**, MinIO 오브젝트 963개. 디스크에 없던 참조 1건은 이관 전부터
      깨져 있던 것이라 그대로 뒀다. 원본 `deploy/uploads` 는 지우지 않았다.
      스크립트는 이제 `POSTGRES_URL`·`MINIO_*`·`UPLOADS_DIR` 을 환경변수로 받아 dev/prod
      양쪽에 쓴다. prod 는 MinIO 포트가 없으므로 컴포즈 네트워크 안의 일회성 컨테이너에서
      돌린다:
      ```
      docker run --rm --network ainmem_prod_default -v /home/comcom/ainmem:/repo -w /repo/app \
        -e POSTGRES_URL=… -e MINIO_ENDPOINT=minio:9000 -e MINIO_ACCESS_KEY=… \
        -e MINIO_SECRET_KEY=… -e MINIO_BUCKET=ainmem-files -e UPLOADS_DIR=/repo/deploy/uploads \
        --user "$(id -u):$(id -g)" node:22-alpine npx tsx ../scripts/migrate-uploads-to-storage.mjs
      ```
- [x] **6. 디스크 정리 (prod, 2026-08-28)** — `/api/upload`(아바타·커버·아이콘)도 스토리지가
      켜져 있으면 승격해 키 주소 경로를 돌려주므로, 이제 `/uploads/` 를 만드는 곳이 없다.
      `deploy/uploads` 5.1GB 삭제 + prod 컴포즈의 바인드 마운트 제거.
      순서를 지켰다: 참조 0 확인 → **마운트만 먼저 떼고 스모크 6개 통과**(디스크를 안
      읽는다는 증명) → 삭제.
      지우기 직전 발견: "디스크에 없다"던 참조 1건의 파일이 `.trash-20260820/` 에 있었다.
      꺼내 이관하고 블록을 고쳤다 — 그대로 지웠으면 유일한 사본을 날렸다.
- [x] **7. 백업 · 워치독 (2026-08-28)**
      - **4.9GB / 3분 10초 → 2.2MB / 1.3초.** tar 에서 `uploads` 를 뺐다(남은 것은 OKF
        트리와 아바타).
      - `scripts/backup-objects.sh` cron 등록(일 05:00, 4세트). API 미러라 **앱 정지 없음**
        — 963개 / 4.35 GiB / 12초.
      - **둘 다 있어야 복원된다**: DB 는 `s3://` 문자열만, 미러는 바이트만 갖는다.
      - 워치독이 `State.Paused` 를 먼저 본다 — 단 **10분 넘게** 얼어 있으면 버려진
        pause 로 보고 `docker unpause` 한다(재시작 아님). 백업의 trap 은 SIGKILL·OOM·
        재부팅을 못 잡으므로 그 사이에서 죽으면 영구 정지가 되는데, 그걸 워치독이
        영원히 봐주기만 하면 예전보다 나쁘다. 프로덕션 백업 중 `Paused=true,
        Health=unhealthy` 상태를 실제로 관찰하며 확인했다 — 15일간 매일 04:01
        재시작시킨 바로 그 상태다.

## 남은 것

- **`next.config.ts` 의 `/uploads/*` CSP 헤더** — 이미지에 구워져 있어 다음 배포 때 빠진다.
  지금은 그 경로 자체가 없어 무해하므로 이것 때문에 배포하지는 않는다.
- ~~tus 스테이징 GC~~ **막았다(2026-08-28).** 다만 원인이 예상과 달랐다.
  `cleanUpExpiredUploads()` 를 붙여도 **0건**이었다 — `FileKvStore.list()` 는 `<id>` 와
  `<id>.json` 이 **둘 다** 있을 때만 그 id 를 돌려주는데, 우리 finalize 가 데이터 파일을
  이미 옮겨 놓아서 남는 것은 **짝 없는 사이드카**뿐이라 라이브러리 수집기에는 영영 안
  보인다. dev 에 58개가 그렇게 쌓여 있었다.
  둘 다 고쳤다: finalize 가 `store.remove()`(먼저 조회하므로 실패한다) 대신 스테이징
  항목을 직접 지우고, `/api/cron/cleanup` 이 나이로 고아 사이드카까지 쓸어낸다(매시).
  검증: 늙힌 조각 1개가 쓸려 나갔고(58→57), 그 뒤 파일 7개를 올려도 조각이 늘지 않았다.
- **오브젝트 백업이 주 1회다**(`0 5 * * 0`, 4세트). 오브젝트는 불변이라 *있던* 키는
  안전하지만, **최근 최대 7일간 새로 올라온 파일은 어느 백업에도 없는데 매일 뜨는 DB 덤프는
  그걸 참조한다.** 12초짜리 작업이라 매일로 올리는 게 맞다고 본다(디스크 1.5T 여유; 4세트
  ×4.4GiB) — 크론 변경은 사람이 결정.
- **`files.tar.gz` 는 사실상 비어 있다(131바이트).** 호스트의 `deploy/okf-content`·
  `deploy/avatars` 는 둘 다 파일 0개다. 컨테이너의 `/data/md-mirror`(볼륨
  `ainmem_prod_mdmirror`, 2.5MB)는 어느 백업에도 안 들어간다. 오늘 생긴 문제는 아니고
  (어제 세트도 okf-content 는 디렉터리 항목 하나였다) 파생물이면 무해하지만, 밤 백업의
  내용이 **DB 덤프뿐**이라는 건 알고 있어야 한다.
- **되돌릴 유일한 디스크 사본**은 `~/ainmem-backups/keep-last-disk-uploads-20260828_115446/`
  (files.tar.gz 5.18GB, 삭제 직전). 회전 glob(`[0-9]*_[0-9]*`)에서 빠지도록 이름을 바꿔
  두었다 — 안 그랬으면 KEEP=14 로 9/11 에 자동 삭제됐다. 이관이 검증되면 손으로 지운다.
- **고아 오브젝트 청소가 없다.** 댓글을 지우면 `files` 행은 cascade 로 사라지지만 MinIO 의
  바이트는 남는다. `files` 테이블 덕에 "참조 0인 키"를 한 쿼리로 물을 수 있게는 됐다.
- **dev 의 `public/uploads` 원본** 은 아직 남아 있다(이관 완료 후에도). prod 처럼 지워도
  되지만 급하지 않다.

## 로컬에서 MinIO 띄우기

```bash
docker compose -f docker-compose.local.yml up -d minio
```

**env 를 켰으면 컨테이너도 떠 있어야 한다.** ainteams 는 스택에서 minio 가 빠진 채
`isStorageConfigured()` 만 true 여서 첫 업로드가 500 이었고 폴백에도 못 갔다. env 를
비워두면 앱은 디스크로 동작하고 이 컨테이너는 필요 없다.

```
MINIO_ENDPOINT=localhost:9000   # host 또는 host:port, 스킴 붙여도 된다
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=ainmem-files       # 생략 시 기본값
```
