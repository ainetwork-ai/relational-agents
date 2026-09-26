# ainmem app

The application behind [AINMEM](../README.md): connect family-owned device folders through
aindrive, turn shared sources into lasting relationship-agent memory, and read or use that
memory through pages, databases and chat. The app also hosts the AIN-UI integration and
Relation Treasury. See the root README for the P2P home-server direction and current runtime
requirements.

## Start locally

Follow [Running it](../README.md#running-it) for PostgreSQL, `.env.local`, schema setup and
optional sign-in/AI services. From the repository root, use:

```bash
scripts/dev.sh
```

Open `http://localhost:3110`. The script reuses an existing server and keeps development build
output in `.next-dev3110`. See [CLAUDE.md](../CLAUDE.md) for shared-workspace rules.

## Commands

Run these from `app/`. Export `POSTGRES_URL` for schema commands; these standalone CLI
commands do not automatically load Next.js `.env.local`.

| Command | Purpose |
|---|---|
| `pnpm typecheck` | TypeScript checks |
| `pnpm lint` | ESLint |
| `pnpm db:check` | Detect missing schema |
| `pnpm db:push` | Apply schema changes to the selected database after reviewing the diff |
| `pnpm check:prompt` | Prompt-export checks |
| `pnpm exec playwright test` | Browser specs; see the root README's database/fixture setup notes |
| `pnpm build` | Copy preview assets and build the application |
| `pnpm demo:family` | Seed the family demo after its accounts and drives are prepared |

## References

- [Environment example](.env.example) and [deployment guide](../docs/deployment.md)
- [Family demo setup](../docs/demo.md) and [aindrive source](https://github.com/ainetwork-ai/aindrive)
- [Object storage](../docs/object-storage.md)
- [AIN-UI integration](../README.md#ain-ui--shared-file-and-payment-surfaces) and [package source](https://github.com/ainetwork-ai/AIN-UI)
- [World / Relation Treasury](../world/README.md) and [Uniswap](../uniswap/README.md)
- [HTTP MCP implementation](src/app/api/mcp/route.ts) and [stdio MCP wrapper](../relational-memory-mcp/README.md)
