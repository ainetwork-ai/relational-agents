#!/usr/bin/env node
// Open (or close) World's 24-hour staging verification window for our app and
// save the token it issues, without printing the key or the token.
//
//   node scripts/world-staging-window.mjs [--env <file>] [--app-id app_…] [--close]
//
//     --env     the env file that receives WORLD_STAGING_VERIFICATION_TOKEN
//               (default: app/.env.local; the xyz deploy uses its .env.xyz)
//     --app-id  the Developer Portal app (default: NEXT_PUBLIC_WORLD_ID_APP_ID
//               from that env file)
//     --close   close the window early; the token is removed
//
// The team API key (Developer Portal → Team settings → API keys, starts with
// "api_") is read from WORLD_TEAM_API_KEY, or typed at a hidden prompt. It is
// used once, for this call, and never written anywhere.
//
// Why: World's /api/v4/verify accepts staging (simulator) proofs only while the
// app's team has opened this window, and every such verify call must send the
// window's token as x-staging-verification-token (lib/worldid-v4.ts does when
// the token is set). Both are decided in the Developer Portal's MCP,
// web/api/mcp/index.ts and web/api/v4/verify/staging-access.ts. The window
// closes by itself after 24 hours; run this again to reopen, and update the
// deploy's env (a container reads its env file only when it is created).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const envPath = resolve(flag("--env") ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local"));
const close = argv.includes("--close");

const text = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  text
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const appId = flag("--app-id") ?? env.NEXT_PUBLIC_WORLD_ID_APP_ID;
if (!appId?.startsWith("app_")) {
  console.error(`no app id: pass --app-id app_… or set NEXT_PUBLIC_WORLD_ID_APP_ID in ${envPath}`);
  process.exit(2);
}

async function readKey() {
  const fromEnv = process.env.WORLD_TEAM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    console.error("set WORLD_TEAM_API_KEY, or run this in a terminal to type the key at a hidden prompt");
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // hide what is typed: readline echoes through _writeToOutput
  const silent = { on: false };
  rl._writeToOutput = function (s) {
    if (!silent.on) rl.output.write(s);
  };
  return new Promise((done) => {
    rl.question("Team API key (api_…, not shown): ", (answer) => {
      silent.on = false;
      rl.output.write("\n");
      rl.close();
      done(answer.trim());
    });
    silent.on = true;
  });
}

const key = await readKey();
if (!key.startsWith("api_")) {
  console.error("that is not a team API key (they start with api_) — nothing was changed");
  process.exit(2);
}

const res = await fetch("https://developer.world.org/api/mcp", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "set_world_id_staging_verification", arguments: { app_id: appId, enabled: !close } },
  }),
  signal: AbortSignal.timeout(30_000),
});
const raw = await res.text();
// the answer is plain JSON, or one SSE "data:" line
const line = raw.startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5);
let json;
try {
  json = JSON.parse(line ?? "");
} catch {
  console.error(`portal answered ${res.status} with something that is not JSON-RPC — nothing was changed`);
  process.exit(1);
}
if (json.error || json.result?.isError) {
  const why = json.error?.message ?? json.result?.content?.[0]?.text ?? JSON.stringify(json);
  console.error(`portal refused: ${String(why).slice(0, 300)} — nothing was changed`);
  process.exit(1);
}
const out = json.result?.structuredContent ?? JSON.parse(json.result?.content?.[0]?.text ?? "{}");

const keep = text.split("\n").filter((l) => !/^\s*WORLD_STAGING_VERIFICATION_(TOKEN|EXPIRES_AT)\s*=/.test(l));
while (keep.length && keep[keep.length - 1] === "") keep.pop();
if (!close) {
  if (!out.staging_verification_token) {
    console.error("the portal opened the window but returned no token — nothing was written");
    process.exit(1);
  }
  keep.push(`WORLD_STAGING_VERIFICATION_TOKEN=${out.staging_verification_token}`);
  keep.push(`WORLD_STAGING_VERIFICATION_EXPIRES_AT=${out.staging_verification_expires_at ?? ""}`);
}
writeFileSync(envPath, keep.join("\n") + "\n");
console.log(
  close
    ? `staging window closed for ${appId}; token removed from ${envPath}`
    : `staging window open for ${appId} until ${out.staging_verification_expires_at} — token saved to ${envPath} (not shown). Restart the app so it reads the new env.`
);
