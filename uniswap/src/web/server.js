// The page: one HTML file and five JSON routes over the same runOnce, ledger and signer the CLIs use.
// Env as the CLIs — AGENT_PK (required), MEMBER_PK (to sign), CHAIN, RPC_URL, PASSBOOK_PATH, SWAP_PROVIDER,
// LEDGER — plus WEB_PORT (default 3120). Binds to 127.0.0.1 only: the agent's key is behind these routes.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { chainByName } from "../chains/index.js";
import { swapProvider } from "../swap/index.js";
import { ledgerByName } from "../ledger/index.js";
import { webApi } from "./api.js";

const key = process.env.AGENT_PK;
if (!key) { console.error("AGENT_PK is required"); process.exit(2); }
const chain = chainByName();
const api = webApi({ ledger: ledgerByName(), swap: swapProvider(undefined, chain), chain,
  account: privateKeyToAccount(key), member: process.env.MEMBER_PK ? privateKeyToAccount(process.env.MEMBER_PK) : undefined });
const html = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)));

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("body is not JSON")); } });
  req.on("error", reject);
});

// The real run is the one route that spends: it needs `confirm: true` in the body, which the page
// only sends after the person has answered a dialog.
const routes = {
  "GET /api/state": (url) => api.state(url.searchParams.get("now") || undefined),
  "POST /api/dry-run": (_, body) => api.dryRun(body.now),
  "POST /api/run": (_, body) => { if (body.confirm !== true) throw new Error("run needs confirm: true"); return api.run(body.now); },
  "POST /api/mandate/sign": (_, body) => api.sign(body),
  "POST /api/mandate/revoke": (_, body) => api.revoke(body),
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html); }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return json(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  try {
    json(res, 200, await route(url, req.method === "POST" ? await readBody(req) : undefined));
  } catch (err) {
    // The page shows this line; it is the provider's short message, never err.message with the RPC URL in it.
    json(res, 400, { error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 300) });
  }
});
const port = Number(process.env.WEB_PORT ?? 3120);
server.listen(port, "127.0.0.1", () => console.log(`Family Passbook on http://127.0.0.1:${port} — chain ${chain.name}, agent ${privateKeyToAccount(key).address}`));
