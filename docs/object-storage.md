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

**이 두 갈래가 업로드 allowlist 의 html/svg 허용 근거다.** 지금은 그 역할을
`next.config.ts` 의 `/uploads/*` CSP sandbox + nosniff 가 하고 있고, 6단계에서 이쪽으로
넘어온다.

## 단계

- [x] **1. 스토리지 계층** — `app/src/lib/files/storage.ts`. MinIO 클라이언트, 키 규칙,
      `putFile/putStream/statFile/streamFile`, lazy bucket. `isStorageConfigured()` 가
      false 면(= MINIO_* env 없음) **모든 호출자가 지금의 디스크 경로 그대로**라 동작이
      바뀌지 않는다. `e2e/storage-layer.check.mjs` 가 키 규칙과 폴백을 고정한다.
- [ ] 2. `files` 테이블 + 프록시 라우트 (아직 아무도 안 씀)
- [ ] 3. tus 완료 훅에서 승격 — 스트리밍 해시 → `contentKey`, `statFile` 로 dedup·멱등
- [ ] 4. 댓글 첨부를 `files` 행 참조로 (지금 jsonb. prod 에 그 컬럼이 아직 없어서
      실데이터 마이그레이션이 0 인 지금이 제일 싸다)
- [ ] 5. 기존 5GB 이관 + DB 참조 치환 ⚠️ 운영
- [ ] 6. `/uploads/*` 정적 서빙 제거, CSP 방어선을 프록시 라우트로 ⚠️ 운영
- [ ] 7. 백업 재구성(오브젝트 미러 + DB 분리), pause 제거, 워치독이 paused 를 알게 ⚠️ 운영

5~7 은 착수 전에 사람에게 확인받는다.

## 아직 안 고친 것

**워치독은 여전히 "얼어 있음"과 "고장"을 구분하지 못한다.** 7단계 후 정지가 몇 초로 줄어
증상은 사라지지만 맹점은 남는다 — 무엇이든 컨테이너를 90초 이상 멈추면 되살아난다.
7단계에서 같이 정리한다.

## 로컬에서 MinIO 띄우기

아직 compose 에 없다(2단계에서 추가). 그때까지 env 를 비워두면 디스크 경로로 동작한다.

```
MINIO_ENDPOINT=localhost:9000   # host 또는 host:port, 스킴 붙여도 된다
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=ainmem-files       # 생략 시 기본값
```
