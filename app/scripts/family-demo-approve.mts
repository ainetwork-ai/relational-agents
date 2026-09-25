/**
 * Plays a family member's phone answering an invite: opens the invite link,
 * approves on aindrive as them (their wallet), joins, and shares the folders
 * the invite page would have ticked (every category on by default — health
 * and money stay off). For a live demo without a second phone in hand.
 *
 *   pnpm tsx scripts/family-demo-approve.mts --as grandpa --invite <url or token> [--app http://localhost:3110]
 */
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { privateKeyToAccount } = await import("viem/accounts");
const { createSiweMessage } = await import("viem/siwe");

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const WHO = arg("as");
const INVITE = arg("invite");
const APP = (arg("app", "http://localhost:3110") as string).replace(/\/+$/, "");
const HOME = arg("home", path.join(os.homedir(), ".ainmem-demo")) as string;
const AIN = (process.env.AINDRIVE_SERVER || "https://aindrive.ainetwork.ai").replace(/\/+$/, "");
if (!WHO || !INVITE) {
  console.error("usage: family-demo-approve.mts --as <grandma|mom|dad|seoyeon|grandpa> --invite <url or token>");
  process.exit(2);
}
const token = INVITE.split("/family/").pop()!.replace(/[?#].*$/, "");
const keys = JSON.parse(fs.readFileSync(path.join(HOME, "family-keys.json"), "utf8")) as Record<string, `0x${string}`>;
if (!keys[WHO]) throw new Error(`no key for ${WHO} — run family-demo-accounts.mts`);

// the phone's browser session on aindrive (signed in with the wallet)
const account = privateKeyToAccount(keys[WHO]);
const { nonce } = await (await fetch(`${AIN}/api/wallet/nonce`, { method: "POST" })).json();
const u = new URL(AIN);
const message = createSiweMessage({ domain: u.host, address: account.address, statement: "Sign in to aindrive", uri: u.origin, version: "1", chainId: 8453, nonce, issuedAt: new Date() });
const login = await fetch(`${AIN}/api/wallet/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: account.address, signature: await account.signMessage({ message }), nonce, message }),
});
const aSession = login.headers.getSetCookie().find((c) => c.startsWith("aindrive_session="))!.split(";")[0].split("=").slice(1).join("=");

// the invite page: "aindrive로 승인하기" → approve on aindrive → signed in here
const jar = new Map<string, string>();
const take = (r: Response) => {
  for (const c of r.headers.getSetCookie()) {
    const [p] = c.split(";");
    const i = p.indexOf("=");
    jar.set(p.slice(0, i), p.slice(i + 1));
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const info = await (await fetch(`${APP}/api/family-invite/${token}`)).json();
if (info.error) throw new Error(`invite: ${info.error}`);
console.log(`📱 ${info.inviter}님이 「${info.teamspace.name}」에 초대했어요 (${info.name})`);
const start = await fetch(`${APP}/api/auth/aindrive/start`, { method: "POST" });
take(start);
const { pairingId, approveUrl } = await start.json();
const linkId = decodeURIComponent(String(approveUrl).split("/cli-login/")[1]);
const ap = await fetch(`${AIN}/api/auth/cli/approve`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `aindrive_session=${aSession}`, origin: AIN },
  body: JSON.stringify({ linkId }),
});
if (!ap.ok) throw new Error(`aindrive approval failed (${ap.status})`);
console.log("✅ aindrive에서 승인");
for (let i = 0; i < 15; i++) {
  const p = await fetch(`${APP}/api/auth/aindrive/poll`, { method: "POST", headers: { "content-type": "application/json", cookie: cookie() }, body: JSON.stringify({ pairingId }) });
  take(p);
  if ((await p.json()).state === "connected") break;
  await new Promise((r) => setTimeout(r, 1500));
}
const joined = await fetch(`${APP}/api/family-invite/${token}`, { method: "POST", headers: { cookie: cookie() } });
if (!joined.ok) throw new Error(`join failed (${joined.status}): ${await joined.text()}`);
console.log("👪 가족 공간에 함께하게 됐어요");
const cats = (await (await fetch(`${APP}/api/family-invite/${token}/categories`, { headers: { cookie: cookie() } })).json()) as {
  categories: { key: string; label: string; defaultOn: boolean; folders: { driveId: string; root: string }[] }[];
};
for (const c of cats.categories) console.log(`   ${c.defaultOn ? "☑" : "☐"} ${c.label}: ${c.folders.map((f) => f.root).join(", ")}`);
const folders = cats.categories.filter((c) => c.defaultOn).flatMap((c) => c.folders);
const shared = await (
  await fetch(`${APP}/api/family-invite/${token}/share`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie() },
    body: JSON.stringify({ folders }),
  })
).json();
console.log(`📂 공유: ${(shared.shared ?? []).join(", ")}${shared.failed?.length ? ` (실패: ${JSON.stringify(shared.failed)})` : ""}`);
process.exit(0);
