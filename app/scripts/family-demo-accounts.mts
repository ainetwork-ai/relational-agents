/**
 * The family demo's three people, made real: each gets their own aindrive
 * account, their own folder served as an aindrive drive, and their own ainmem
 * account connected to it — exactly what "aindrive로 로그인" does in a browser.
 *
 *   pnpm tsx scripts/family-demo-accounts.mts --data <dir> [--app http://localhost:3110]
 *     --data   folder holding grandma/ mom/ dad/ seoyeon/ (the files each person shares)
 *     --app    the ainmem server to connect them to (default http://localhost:3110)
 *     --home   where keys, drive folders and CLI homes live (default ~/.ainmem-demo)
 *     --no-cli skip starting the aindrive CLIs (drives already running)
 *
 * aindrive (AINDRIVE_SERVER, default https://aindrive.ainetwork.ai) makes an
 * account for a wallet that signs in with SIWE, no email needed — so each
 * person is a wallet. The keys are generated once and kept in
 * <home>/family-keys.json (mode 600, outside the repo); reruns reuse them, so
 * the accounts and drives stay the same.
 *
 * Output: <home>/family.json — per person: wallet address, drive folder, and
 * the ainmem user id. scripts/seed-family-demo.mts builds the workspace from it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DATA = arg("data");
const APP = (arg("app", "http://localhost:3110") as string).replace(/\/+$/, "");
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const AINDRIVE = (process.env.AINDRIVE_SERVER || "https://aindrive.ainetwork.ai").replace(/\/+$/, "");
const START_CLI = !process.argv.includes("--no-cli");
if (!DATA) {
  console.error("usage: family-demo-accounts.mts --data <dir with grandma/ mom/ dad/ seoyeon/> [--app URL] [--home DIR] [--no-cli]");
  process.exit(2);
}

/** Who the demo family is: the folder they share, the drive's name on aindrive,
 *  and the name they go by in the workspace. */
const FAMILY = [
  { key: "grandma", name: "할머니", drive: "할머니의 부엌과 앨범" },
  { key: "mom", name: "엄마", drive: "엄마의 살림" },
  { key: "dad", name: "아빠", drive: "아빠의 기록" },
  { key: "seoyeon", name: "서연", drive: "서연이 폰" },
  // not in the family workspace at first — the demo invites him (가족 폴더 → 초대)
  { key: "grandpa", name: "외할아버지", drive: "외할아버지 폰" },
] as const;

fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
const keysFile = path.join(HOME, "family-keys.json");
const keys: Record<string, `0x${string}`> = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : {};
for (const m of FAMILY) keys[m.key] ??= generatePrivateKey();
fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2), { mode: 0o600 });

/** Cookie jar good enough for one origin at a time. */
function jar() {
  const cookies = new Map<string, string>();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    take(res: Response) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    get: (k: string) => cookies.get(k),
  };
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** aindrive: sign in with the wallet (SIWE) — makes the account on first use. */
async function aindriveSession(pk: `0x${string}`): Promise<string> {
  const account = privateKeyToAccount(pk);
  const nonceRes = await fetch(`${AINDRIVE}/api/wallet/nonce`, { method: "POST" });
  const { nonce } = await json(nonceRes);
  const url = new URL(AINDRIVE);
  const message = createSiweMessage({
    domain: url.host,
    address: account.address,
    statement: "Sign in to aindrive",
    uri: url.origin,
    version: "1",
    chainId: 8453,
    nonce,
    issuedAt: new Date(),
  });
  const signature = await account.signMessage({ message });
  const login = await fetch(`${AINDRIVE}/api/wallet/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address, signature, nonce, message }),
  });
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith("aindrive_session="));
  if (!login.ok || !cookie) throw new Error(`aindrive wallet login failed (${login.status}): ${JSON.stringify(await json(login))}`);
  return cookie.split(";")[0].split("=").slice(1).join("=");
}

/** Serve the person's folder as their aindrive drive (the CLI, as that account). */
function startCli(key: string, folder: string, driveName: string, session: string) {
  const home = path.join(HOME, "cli", key);
  fs.mkdirSync(path.join(home, ".aindrive"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(home, ".aindrive", "credentials.json"),
    JSON.stringify({ server: AINDRIVE, sessionCookie: session, savedAt: Date.now() }, null, 2),
    { mode: 0o600 }
  );
  const pidFile = path.join(home, "aindrive.pid");
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    try {
      process.kill(pid, 0);
      return `already running (pid ${pid})`;
    } catch {
      /* stale pid — start again */
    }
  }
  const log = fs.openSync(path.join(home, "aindrive.log"), "a");
  const child = spawn("aindrive", [folder, "--server", AINDRIVE, "--name", driveName, "--no-open"], {
    env: { ...process.env, HOME: home },
    cwd: folder,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  return `started (pid ${child.pid}, log ${path.join(home, "aindrive.log")})`;
}

/** ainmem: "aindrive로 로그인", approved as the person on aindrive. */
async function ainmemSignIn(session: string): Promise<{ userId: string; cookie: string }> {
  const app = jar();
  const start = await fetch(`${APP}/api/auth/aindrive/start`, { method: "POST" });
  app.take(start);
  const { pairingId, approveUrl } = await json(start);
  if (!pairingId) throw new Error(`ainmem sign-in did not start (${start.status})`);
  const linkId = decodeURIComponent(String(approveUrl).split("/cli-login/")[1] ?? "");
  const approve = await fetch(`${AINDRIVE}/api/auth/cli/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `aindrive_session=${session}`, origin: AINDRIVE },
    body: JSON.stringify({ linkId }),
  });
  if (!approve.ok) throw new Error(`aindrive approval failed (${approve.status}): ${JSON.stringify(await json(approve))}`);
  for (let i = 0; i < 15; i++) {
    const poll = await fetch(`${APP}/api/auth/aindrive/poll`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: app.header() },
      body: JSON.stringify({ pairingId }),
    });
    app.take(poll);
    const r = await json(poll);
    if (r.state === "connected") return { userId: r.user.id, cookie: app.header() };
    if (r.state !== "pending") throw new Error(`ainmem sign-in ended: ${JSON.stringify(r)}`);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("ainmem sign-in timed out");
}

const out: Record<string, unknown> = {};
for (const m of FAMILY) {
  const src = path.join(DATA, m.key);
  if (!fs.existsSync(src)) throw new Error(`missing ${src}`);
  // the drive folder lives with the demo, not in a temp dir that may vanish
  const folder = path.join(HOME, "drives", m.key);
  fs.mkdirSync(folder, { recursive: true });
  fs.cpSync(src, folder, { recursive: true, force: true });

  const pk = keys[m.key];
  const address = privateKeyToAccount(pk).address;
  const session = await aindriveSession(pk);
  const cli = START_CLI ? startCli(m.key, folder, m.drive, session) : "skipped";
  const ainmem = await ainmemSignIn(session);
  out[m.key] = { name: m.name, drive: m.drive, wallet: address, folder, ainmemUserId: ainmem.userId };
  console.log(`${m.name}: wallet ${address} · drive "${m.drive}" ${cli} · ainmem user ${ainmem.userId}`);
}
const summary = path.join(HOME, "family.json");
fs.writeFileSync(summary, JSON.stringify({ app: APP, aindrive: AINDRIVE, members: out }, null, 2), { mode: 0o600 });
console.log(`\nwrote ${summary}`);
