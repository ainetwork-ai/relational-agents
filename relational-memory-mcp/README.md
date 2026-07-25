# notion-mcp

An MCP (stdio) server wrapping the full REST API of the notion clone (parent
repo). Exposes 58 routes as 65 tools: pages, blocks, databases (rows/
properties/views), comments, search, upload, sharing, notifications, AI, and OKF.

## Prerequisite

The clone app must be running (`../app`, `npm run dev`).

## Configuration

| env | default | meaning |
|---|---|---|
| `NOTION_BASE_URL` | `http://localhost:3000` | clone app address |
| `NOTION_PRIVATE_KEY` | (none) | key-login if set, else the shared demo-login |
| `NOTION_DISPLAY_NAME` | (none) | display name for key-login |

The server holds an iron-session cookie in memory, auto-logs-in on the first
call, and re-logs-in once on a 401. The `login` tool can switch users mid-session.

## Register with Claude Code

```bash
# run the source directly with tsx (development)
claude mcp add notion-clone \
  --env NOTION_BASE_URL=http://localhost:3000 \
  -- npx tsx /mnt/newdata/git/notion/notion-mcp/src/index.ts

# or after building
npm run build
claude mcp add notion-clone \
  --env NOTION_BASE_URL=http://localhost:3000 \
  -- node /mnt/newdata/git/notion/notion-mcp/dist/index.js
```

## Representative tools

- `login`, `auth_me`, `auth_logout`
- `pages_list`, `page_create`, `page_blocks_get/append/replace`, `page_export(_pdf)`, `page_share_*`, `page_history_*`
- `databases_list`, `database_create`, `database_row_add/update/delete`,
  `database_property_add/update/delete`, `database_view_add/update/delete` (board = kanban view)
- `search`, `upload_file` (image/file upload), `import_notion_zip`
- `page_comments_list`, `page_comment_add`, `comment_update/delete`
- `okf_tree`, `okf_node`, `okf_page_write`, `okf_db_*` — direct file-backend (OKF) access
- `api_request` — raw escape hatch for unmapped endpoints

Binary responses (PDF/zip/asset) are saved to a temp file and the path returned.

## Not supported

- `GET /api/pages/{id}/events` (SSE realtime stream) — excluded; it doesn't fit
  the MCP request/response model.
