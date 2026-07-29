import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Shared helpers for the demo-scene e2e specs. A "relationship" is born only
 * when two WALLET-backed users both sign the EIP-712 RelationConsent, so these
 * helpers reproduce the real flow end to end:
 *   1. each person logs in with a fresh wallet (challenge + personal_sign),
 *   2. the partner joins the creator's workspace via a real invite token,
 *   3. the creator opens the relationship room,
 *   4. both wallets sign the consent typedData → the agent is born.
 *
 * Signatures are produced with viem local accounts — the SAME primitives the
 * app's browser wallet uses — so a green consent here means MetaMask would work.
 */

export interface Wallet {
  account: PrivateKeyAccount;
  address: `0x${string}`;
}

export function newWallet(): Wallet {
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, address: account.address.toLowerCase() as `0x${string}` };
}

/** Log a fresh wallet user into `ctx` via the real challenge + personal_sign
 *  metamask-verify flow. Returns the created user id. */
export async function loginWallet(
  ctx: APIRequestContext,
  wallet: Wallet,
  displayName: string
): Promise<string> {
  const ch = await ctx.get("/api/auth/challenge");
  expect(ch.ok(), "GET /api/auth/challenge").toBeTruthy();
  const { message } = await ch.json();
  const signature = await wallet.account.signMessage({ message });
  const res = await ctx.post("/api/auth/metamask-verify", {
    data: { signature, address: wallet.address, displayName },
  });
  expect(res.ok(), `metamask-verify ${displayName}: ${res.status()}`).toBeTruthy();
  const { user } = await res.json();
  expect(user?.id).toBeTruthy();
  return user.id as string;
}

/** Create a workspace invite from the owner and join `joiner` to it — the real
 *  path that puts two people in one workspace so a room can be opened. */
export async function inviteAndJoin(
  owner: APIRequestContext,
  joiner: APIRequestContext
): Promise<void> {
  const inv = await owner.post("/api/workspace/invite");
  expect(inv.ok(), `POST /api/workspace/invite: ${inv.status()}`).toBeTruthy();
  const { token } = await inv.json(); // POST returns a flat { token, url }
  expect(token, "invite token minted").toBeTruthy();
  const join = await joiner.post(`/api/invite/${token}`);
  expect(join.ok(), `POST /api/invite/[token]: ${join.status()}`).toBeTruthy();
}

/** Open a 1:1 relationship room from the creator with one partner. Returns the
 *  room id and its auto-derived "{me} ❤️ {partner}" name. */
export async function openRoom(
  creator: APIRequestContext,
  partnerId: string
): Promise<{ id: string; name: string }> {
  const res = await creator.post("/api/dm/rooms", { data: { memberIds: [partnerId] } });
  expect(res.ok(), `POST /api/dm/rooms: ${res.status()}`).toBeTruthy();
  const { room } = await res.json();
  expect(room?.id).toBeTruthy();
  return { id: room.id, name: room.name };
}

/** Have one wallet sign the room's current consent typedData and submit it.
 *  Returns the /consent status after the POST. */
export async function signConsent(
  person: Pick<Person, "ctx" | "wallet">,
  roomId: string
): Promise<{ consentAt: string | null; mySigned: boolean; required: number }> {
  const g = await person.ctx.get(`/api/dm/rooms/${roomId}/consent`);
  expect(g.ok(), "GET /consent").toBeTruthy();
  const status = await g.json();
  expect(status.typedData, "consent typedData present").toBeTruthy();
  const signature = await person.wallet.account.signTypedData(status.typedData);
  const p = await person.ctx.post(`/api/dm/rooms/${roomId}/consent`, {
    data: { signature },
  });
  expect(p.ok(), `POST /consent: ${p.status()}`).toBeTruthy();
  return p.json();
}

/** Drive a 2-party consent to completion (both sign). Returns final consent
 *  status — `consentAt` non-null means the agent was born. */
export async function bornRelationship(
  a: Pick<Person, "ctx" | "wallet">,
  b: Pick<Person, "ctx" | "wallet">,
  roomId: string
) {
  await signConsent(a, roomId);
  await signConsent(b, roomId); // completing signature stamps consentAt + births the agent
  const g = await a.ctx.get(`/api/dm/rooms/${roomId}/consent`);
  return g.json() as Promise<{ consentAt: string | null; required: number }>;
}

/** Have one wallet sign the room's RelationDissolve typedData and submit it. */
export async function signDissolve(
  person: Pick<Person, "ctx" | "wallet">,
  roomId: string
): Promise<{ dissolvedAt: string | null; mySigned: boolean }> {
  const g = await person.ctx.get(`/api/dm/rooms/${roomId}/dissolve`);
  expect(g.ok(), "GET /dissolve").toBeTruthy();
  const status = await g.json();
  expect(status.typedData, "dissolve typedData present").toBeTruthy();
  const signature = await person.wallet.account.signTypedData(status.typedData);
  const p = await person.ctx.post(`/api/dm/rooms/${roomId}/dissolve`, {
    data: { signature },
  });
  expect(p.ok(), `POST /dissolve: ${p.status()}`).toBeTruthy();
  return p.json();
}

/** Post a chat message (optionally with image attachments) into a room. */
export async function postMessage(
  ctx: APIRequestContext,
  roomId: string,
  text: string,
  attachments: { name: string; url: string }[] = []
): Promise<{ id: string }> {
  const res = await ctx.post(`/api/dm/rooms/${roomId}/messages`, {
    data: { text, attachments },
  });
  expect(res.ok(), `POST /messages: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body.message ?? body;
}

/** List the room's messages (helper for asserting greetings / recordings). */
export async function listMessages(
  ctx: APIRequestContext,
  roomId: string
): Promise<{ authorId: string; text: string }[]> {
  const res = await ctx.get(`/api/dm/rooms/${roomId}/messages`);
  expect(res.ok(), "GET /messages").toBeTruthy();
  const body = await res.json();
  return (body.messages ?? body) as { authorId: string; text: string }[];
}

/** The relationship agents living in the caller's rooms (sidebar "Agents"). */
export async function myAgents(
  ctx: APIRequestContext
): Promise<{ agentUserId: string; displayName: string; roomId: string; roomName: string }[]> {
  const res = await ctx.get("/api/agent/mine");
  expect(res.ok(), "GET /api/agent/mine").toBeTruthy();
  return (await res.json()).agents ?? [];
}

/** A logged-in wallet person on an isolated browser context (own cookie jar).
 *  Use `.context` for UI pages and `.ctx` for API calls — they share cookies. */
export interface Person {
  context: BrowserContext;
  ctx: APIRequestContext;
  wallet: Wallet;
  id: string;
  name: string;
}

/** Spin up an isolated context and log a fresh wallet user into it. */
export async function spawnPerson(
  browser: Browser,
  baseURL: string | undefined,
  name: string
): Promise<Person> {
  const context = await browser.newContext({ baseURL });
  const wallet = newWallet();
  const id = await loginWallet(context.request, wallet, name);
  return { context, ctx: context.request, wallet, id, name };
}

/** Resolve the isolated OKF working root the e2e server writes docs into. */
export function okfRoot(): string {
  return path.resolve(__dirname, ".okf-work");
}

/** Recursively read every markdown/text doc under the OKF root as {file,content}
 *  — used to assert what a relationship's agent recorded (and, for isolation,
 *  what a DIFFERENT relationship's agent did NOT). */
export function readOkfDump(): { file: string; content: string }[] {
  const root = okfRoot();
  const out: { file: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|txt|json|csv)$/i.test(entry.name))
        out.push({ file: full, content: fs.readFileSync(full, "utf8") });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** Poll until the OKF dump contains a doc matching `re`, or throw after timeout
 *  (the write-pipeline runs inside the message POST, but fs flush + folder
 *  creation can lag a beat behind the HTTP response). */
export async function waitForOkfDoc(
  re: RegExp,
  timeoutMs = 10_000
): Promise<{ file: string; content: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = readOkfDump().find((d) => re.test(d.content));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`OKF doc matching ${re} not written in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
