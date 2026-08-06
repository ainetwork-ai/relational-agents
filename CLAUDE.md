# ainmem — 여러 세션이 같이 일할 때의 규칙

이 레포는 사람과 에이전트 여러 세션이 **동시에** 만진다. 아래는 그래서 생긴 규칙들이다.
전부 실제로 한 번씩 터진 것들이라, 취향이 아니라 사고 기록에 가깝다.

## dev 서버는 한 대만 — `scripts/dev.sh`

```bash
scripts/dev.sh            # 없으면 띄우고, 있으면 그걸 쓴다
scripts/dev.sh status     # 누가 어디에 떠 있고 로그가 어디인지
scripts/dev.sh logs -f
scripts/dev.sh restart    # 이 레포의 서버일 때만 움직인다
```

- **직접 `pnpm dev` 하지 말 것.** 세션마다 띄우면 포트를 서로 뺏고, 뺏긴 쪽은 조용히
  죽는다(`ELIFECYCLE`). 브라우저는 죽은 서버를 계속 두드리며 "컴파일 중"에서 멈춘
  것처럼 보인다.
- 포트 **3110**, 빌드 디렉터리 **`.next-dev3110`**(기본 `.next`를 쓰면 다른 세션의
  prod/e2e 빌드를 덮는다), 로그/pid 는 레포 밖 `~/.ainmem-dev/`.
- **접속은 `http://localhost:3110`.** `127.0.0.1`과 LAN 주소는 Next 에게 다른
  오리진이라 `next.config.ts`의 `allowedDevOrigins`에 없으면 `/_next/*`가 막히고,
  페이지가 하이드레이션 없이 영원히 "컴파일 중"으로 남는다.
- 남의 서버를 죽이지 말 것. `stop`/`restart`는 프로세스의 cwd 가 이 레포일 때만 움직인다.

## 커밋은 내가 만진 파일만

`git commit -a` / `git add -A` 금지. 워킹트리에는 **다른 세션이 편집 중인 파일**이
섞여 있다. 한 번은 그렇게 남의 미완성 변경이 커밋에 딸려 들어가, 컴포넌트를 부르는
쪽만 커밋되고 컴포넌트 자체는 untracked 로 남아 HEAD 가 깨진 적이 있다.
경로를 하나씩 `git add <path>` 할 것.

## 스키마는 손으로 민다

`drizzle-kit push`는 DB 하나씩, 사람이 판단해서(docs/deployment.md §3.6). 부팅 로그와
`/api/health`(503), `pnpm db:check`가 무엇이 모자란지 알려준다. dev DB 는
`localhost:5434`.

## 노션 캡처는 `docs/*.html`

무엇을 따라 만드는지가 거기 있다. 커밋되지 않는다(대용량 + 사내 데이터). 어떤 화면의
어떤 상태인지는 `docs/notion-captures.md` 참고.
