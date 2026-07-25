# notion-mcp 통합 가이드

노션 클론(`../app`)의 REST API 전체를 감싸는 **stdio MCP 서버**. 에이전트/Claude가
페이지·데이터베이스·블록·업로드·검색 등 58개 라우트를 **80개 툴**로 사용할 수 있다.

- **서버 위치**: `/mnt/newdata/git/notion/notion-mcp`
- **엔트리**: `dist/index.js` (빌드 산출물) / `src/index.ts` (소스)
- **전송 방식**: stdio (JSON-RPC)

---

## 1. 사전 준비

### (a) 노션 클론 앱이 떠 있어야 한다

MCP 서버는 클론의 HTTP API를 호출하는 얇은 래퍼다. 앱이 없으면 모든 툴이
`fetch failed`를 낸다.

```bash
cd /mnt/newdata/git/notion/app
PORT=3010 npm run dev        # 포트는 자유. 아래 NOTION_BASE_URL과 일치시킬 것
```

> ⚠️ 이 호스트는 포트가 유동적이다(3000·36625 등이 다른 프로젝트와 번갈아 점유).
> **띄운 실제 포트를 확인**하고 `NOTION_BASE_URL`을 거기에 맞춘다:
> ```bash
> ss -tlnp | grep next-server      # 어떤 포트에 next가 떠 있는지
> curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>/login   # 200이면 OK
> ```

### (b) MCP 서버 빌드

```bash
cd /mnt/newdata/git/notion/notion-mcp
npm install
npm run build        # → dist/index.js
```

---

## 2. 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `NOTION_BASE_URL` | `http://localhost:3000` | 클론 앱 주소. **실제 뜬 포트로 반드시 지정** |
| `NOTION_PRIVATE_KEY` | (없음) | 있으면 key-login(개인 계정), 없으면 공용 demo-login |
| `NOTION_DISPLAY_NAME` | (없음) | key-login 시 표시 이름 |

인증은 iron-session 쿠키를 메모리에 들고 첫 호출에서 자동 로그인하고, 401이면 1회
재로그인한다. 세션 중 사용자 전환은 `login` 툴로 한다.

---

## 3. 등록 방법

### Claude Code (CLI)

```bash
claude mcp add notion-clone \
  --env NOTION_BASE_URL=http://localhost:3010 \
  -- node /mnt/newdata/git/notion/notion-mcp/dist/index.js
```

### `.mcp.json` / `--mcp-config` (헤드리스·서브에이전트)

```json
{
  "mcpServers": {
    "notion-clone": {
      "command": "node",
      "args": ["/mnt/newdata/git/notion/notion-mcp/dist/index.js"],
      "env": { "NOTION_BASE_URL": "http://localhost:3010" }
    }
  }
}
```

```bash
claude -p "<작업>" \
  --mcp-config ./notion-mcp-config.json \
  --allowedTools "mcp__notion-clone__*"
```

빌드 없이 소스로 돌리려면 `node .../dist/index.js` 대신
`npx tsx /mnt/newdata/git/notion/notion-mcp/src/index.ts`.

---

## 4. 툴 카탈로그 (80개)

호출 시 접두사 `mcp__notion-clone__`가 붙는다 (예: `mcp__notion-clone__page_create`).

| 그룹 | 툴 |
|---|---|
| **인증** | `login`, `auth_me`, `auth_logout` |
| **워크스페이스** | `workspace_get/update`, `workspace_members_list`, `workspace_member_update/remove`, `workspace_guests_list`, `workspace_invite_get/create`, `workspace_export`, `workspaces_list`, `workspace_create`, `workspace_switch`, `teamspaces_list`, `teamspace_create` |
| **페이지** | `pages_list`, `pages_shared_list`, `page_create/get/update/delete/duplicate`, `page_row_get`, `page_export`, `page_export_pdf`, `page_history_list/restore`, `page_members_list`, `page_member_add/remove`, `page_presence_get/ping` |
| **블록** | `page_blocks_get`, `page_blocks_append`, `page_blocks_replace` |
| **공유** | `page_share_get/create/update/delete`, `invite_info`, `invite_accept`, `share_unlock`, `share_duplicate` |
| **댓글** | `page_comments_list`, `page_comment_add`, `comment_update/delete` |
| **데이터베이스** | `databases_list`, `database_create/get/update`, `database_row_add/update/delete`, `database_property_add/update/delete`, `database_view_add/update/delete`, `database_link`, `database_fullpage` |
| **검색·파일** | `search`, `upload_file`, `import_notion_zip` |
| **알림** | `notifications_list`, `notifications_mark_read` |
| **AI** | `ai_write`, `ai_qa`, `ai_autofill` |
| **OKF(파일 백엔드)** | `okf_tree`, `okf_pages`, `okf_node`, `okf_page_write`, `okf_db_create/update`, `okf_asset` |
| **탈출구** | `api_request` (매핑 안 된 `/api/*` 엔드포인트 직접 호출) |

바이너리 응답(PDF·zip·asset)은 임시 파일로 저장하고 그 경로를 돌려준다.
SSE 스트림 `GET /api/pages/{id}/events`는 요청/응답 모델과 안 맞아 제외.

---

## 5. 블록 작성 규칙 (에이전트가 자주 틀리는 지점)

- **블록 추가**: `page_blocks_append`, body에 블록 하나씩
  `{ "type": "paragraph", "content": { "text": "..." } }`.
  `position`은 생략하면 **문서 끝에 붙는다** (예전엔 항상 1로 꽂히는 버그가 있었으나 수정됨).
- **텍스트 content**: 반드시 `{ "text": "..." }` 객체. 문자열을 그대로 넘겨도
  서버가 `{text}`로 정규화하지만 객체 형태를 권장.
- **표(table) 블록**: `{ "type": "table", "content": { "table": { "cells": [["h1","h2"],["a","b"]], "headerRow": true } } }`.
  `content.cells`로 바로 넣어도 서버가 `content.table.cells`로 감싸준다.
- **이미지 블록**: `upload_file`로 로컬 파일 업로드 → 반환된 `url`로
  `{ "type": "image", "content": { "url": "/uploads/....jpeg" } }`.
- **`page_blocks_replace`는 완전 교체가 아니다** — id 없는 블록은 insert, 기존 블록은
  `deletedIds`에 명시하지 않으면 남는다. 진짜 교체하려면 현재 블록 id들을
  `deletedIds`로 함께 넘긴다.
- 지원 블록 타입: paragraph, heading1~3, bulleted_list, numbered_list, todo, toggle,
  quote, divider, code, callout, image, table, database, bookmark, embed, video,
  equation 등.

---

## 6. 스모크 테스트

앱이 뜬 포트를 `PORT`에 넣고:

```bash
PORT=3010
{ printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"auth_me","arguments":{}}}'; sleep 4; } \
| NOTION_BASE_URL=http://localhost:$PORT node dist/index.js 2>/dev/null
```

`auth_me`가 `DemoUser`를 돌려주면 정상.

---

## 7. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 모든 툴이 `fetch failed` | 앱이 안 떠 있거나 `NOTION_BASE_URL` 포트 불일치. `ss -tlnp \| grep next-server`로 실제 포트 확인 |
| `401` 반복 | 세션 만료. `login` 툴 재호출(자동 재로그인도 1회 시도함) |
| 블록이 UI에서 빈 줄로 보임 | content 형태 오류. 5절 규칙대로 `{text}`/`{table}` 사용 |
| 표가 빈 그리드로 보임 | `cells`를 `content.table.cells` 위치에 두었는지 확인(서버가 감싸주지만 확인) |
| 매핑 안 된 엔드포인트 필요 | `api_request { method, path, query?, body? }` 사용 |
