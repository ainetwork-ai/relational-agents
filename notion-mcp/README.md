# notion-mcp

노션 클론(상위 저장소)의 전체 REST API를 감싸는 MCP(stdio) 서버.
페이지·블록·데이터베이스(행/속성/뷰)·댓글·검색·업로드·공유·알림·AI·OKF까지
58개 라우트를 65개 툴로 노출한다.

## 실행 전제

클론 앱이 떠 있어야 한다 (`../app`, `npm run dev`).

## 설정

| env | 기본값 | 설명 |
|---|---|---|
| `NOTION_BASE_URL` | `http://localhost:3000` | 클론 앱 주소 |
| `NOTION_PRIVATE_KEY` | (없음) | 있으면 key-login, 없으면 공용 demo-login |
| `NOTION_DISPLAY_NAME` | (없음) | key-login 시 표시 이름 |

인증은 iron-session 쿠키를 메모리에 들고 있다가 첫 호출에서 자동 로그인,
401이면 1회 재로그인한다. `login` 툴로 세션 중 사용자 전환도 가능.

## Claude Code에 등록

```bash
# tsx로 소스 직접 실행 (개발)
claude mcp add notion-clone \
  --env NOTION_BASE_URL=http://localhost:3000 \
  -- npx tsx /mnt/newdata/git/notion/notion-mcp/src/index.ts

# 또는 빌드 후
npm run build
claude mcp add notion-clone \
  --env NOTION_BASE_URL=http://localhost:3000 \
  -- node /mnt/newdata/git/notion/notion-mcp/dist/index.js
```

## 대표 툴

- `login`, `auth_me`, `auth_logout`
- `pages_list`, `page_create`, `page_blocks_get/append/replace`, `page_export(_pdf)`, `page_share_*`, `page_history_*`
- `databases_list`, `database_create`, `database_row_add/update/delete`,
  `database_property_add/update/delete`, `database_view_add/update/delete` (보드=칸반 뷰)
- `search`, `upload_file`(이미지/파일 업로드), `import_notion_zip`
- `page_comments_list`, `page_comment_add`, `comment_update/delete`
- `okf_tree`, `okf_node`, `okf_page_write`, `okf_db_*` — 파일 백엔드(OKF) 직접 접근
- `api_request` — 매핑 안 된 엔드포인트용 raw 탈출구

바이너리 응답(PDF/zip/asset)은 임시 파일로 저장하고 경로를 돌려준다.

## 미지원

- `GET /api/pages/{id}/events` (SSE 실시간 스트림) — MCP 요청/응답 모델과 맞지 않아 제외.
