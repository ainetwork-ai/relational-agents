# relational-memory-mcp

A stdio MCP server wrapping ainmem's REST API: pages, blocks, databases, comments, search,
uploads, sharing, notifications, AI, chat and OKF. It calls the running app; it does not open
memory files directly. REST authorization applies to the signed-in user.

The app also has a separate **Streamable HTTP MCP endpoint at `/api/mcp`**, which accepts
session cookies, agent tokens or a public read-only service token. See the
[root README](../README.md#a2a-and-mcp) for that interface.

## Setup

Start ainmem using the [root setup guide](../README.md#running-it), then:

```bash
cd relational-memory-mcp
npm ci
npm run build
MEMORY_BASE_URL=http://localhost:3110 npm start
```

Configure your MCP client to run `node /absolute/path/to/relational-agents/relational-memory-mcp/dist/index.js`
with the environment below. For source development, `npm run dev` runs `tsx src/index.ts`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MEMORY_BASE_URL` | `http://localhost:3000` | ainmem address; set port **3110** for the repository dev server |
| `MEMORY_PRIVATE_KEY` | Unset | AIN key passed to the app's key-login endpoint; otherwise uses demo-login |
| `MEMORY_DISPLAY_NAME` | Unset | Display name for key-login |

These names come from [`src/index.ts`](src/index.ts); the old `NOTION_*` variables are not read.
The wrapper holds a session cookie in memory, signs in lazily, and retries login once on a 401.
The `login` tool can switch users. Login without a key requires `DEMO_LOGIN_ADDRESS` on the app;
production also requires `ENABLE_DEMO_LOGIN=1`. Set `MEMORY_PRIVATE_KEY` only for an app server
you trust: key-login sends it to that server. The wrapper does not perform Google or aindrive
browser sign-in.

## Representative tools

- `login`, `auth_me`, `auth_logout`
- `pages_list`, `page_create`, `page_blocks_get`, `page_blocks_append`, `page_blocks_replace`,
  page export, sharing and history tools
- Database, row, property and view tools
- `search`, `upload_file`, `import_notion_zip`, comment and notification tools
- `okf_tree`, `okf_pages`, `okf_node`, `okf_page_write`, `okf_db_create`, `okf_db_update`
- `chat_rooms_list` and chat tools
- `api_request` for REST endpoints without a dedicated tool

The source is the tool inventory; the wrapper does not automatically expose every new API.
Binary responses such as PDF, ZIP and assets are saved to temporary files and returned as paths.
Page event streams (`GET /api/pages/<id>/events`) are not exposed as stdio request/response tools.
