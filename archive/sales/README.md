# Sales demo (archived)

The 영업사원 demo: three salespeople's phones sync call history (markdown)
into their own aindrive; asking the team agent "통합 sales pipeline 만들어줘"
builds a pipeline database from them. Replaced by the family demo; kept for
reference and not wired into package.json.

- `scripts/` — accounts (wallets + phone drives) and workspace seed
- `sales-calls/`, `sales-calls-new/` — the call history data
- `demo.md` — the demo script

The pipeline skill itself stays in the app (`app/src/lib/agent/sales-pipeline.ts`),
used by business-profile agents.
