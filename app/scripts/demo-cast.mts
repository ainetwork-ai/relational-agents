/**
 * Builds the cast for a demo take: three wallets and two consented rooms,
 * printed with the keys you sign in with.
 *
 *   pnpm demo:cast              # against http://127.0.0.1:36625
 *   BASE=http://host:port pnpm demo:cast
 *
 * Everything goes through the real endpoints — key login, room creation, and
 * two EIP-712 signatures per room — so a room made here is indistinguishable
 * from one made on camera, agent registration included. Names get a suffix
 * because a workspace name is globally unique; pass SUFFIX= to control it.
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { chatRooms, workspaceMembers } from "../src/lib/db/schema";

const BASE = (process.env.BASE ?? "http://127.0.0.1:36625").replace(/\/$/, "");
const SUFFIX = process.env.SUFFIX ?? randomBytes(2).toString("hex");

interface Session {
  key: string;
  user: { id: string; displayName: string };
  cookie: string;
}

async function signIn(displayName: string): Promise<Session> {
  const key = randomBytes(32).toString("hex");
  const res = await fetch(`${BASE}/api/auth/key-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ privateKey: key, displayName }),
  });
  if (!res.ok) throw new Error(`${displayName}: sign-in failed (${res.status})`);
  return { key, user: (await res.json()).user, cookie: (res.headers.getSetCookie?.() ?? []).join("; ") };
}

/** Both parties sign the consent contract, which is what mints the agent. */
async function openRoom(name: string, a: Session, b: Session): Promise<string> {
  const res = await fetch(`${BASE}/api/dm/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ memberIds: [b.user.id], name }),
  });
  if (!res.ok) throw new Error(`${name}: room creation failed (${res.status}) ${await res.text()}`);
  const roomId: string = (await res.json()).room.id;

  for (const who of [a, b]) {
    const payload = await fetch(`${BASE}/api/dm/rooms/${roomId}/consent`, { headers: { cookie: who.cookie } });
    const { typedData } = await payload.json();
    const signature = await privateKeyToAccount(`0x${who.key}`).signTypedData(typedData);
    const sent = await fetch(`${BASE}/api/dm/rooms/${roomId}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: who.cookie },
      body: JSON.stringify({ signature }),
    });
    if (!sent.ok) throw new Error(`${name}: ${who.user.displayName} could not sign (${sent.status})`);
  }

  const [room] = await db.select().from(chatRooms).where(eq(chatRooms.id, roomId));
  if (!room?.consentAt) throw new Error(`${name}: both signed but consent did not complete`);
  return roomId;
}

const chanho = await signIn(`Chanho-${SUFFIX}`);
const hannah = await signIn(`Hannah-${SUFFIX}`);
const ava = await signIn(`Ava-${SUFFIX}`);

// A room may only hold members of one workspace, so the other two join Chanho's.
const [home] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, chanho.user.id));
for (const guest of [hannah, ava]) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: home.workspaceId, userId: guest.user.id, role: "member" })
    .onConflictDoNothing();
}

const withHannah = await openRoom(`Chanho ❤️ Hannah`, chanho, hannah);
const withAva = await openRoom(`Chanho ❤️ Ava`, chanho, ava);

console.log(`\nCast ready — sign in with these keys on ${BASE}/login\n`);
for (const who of [chanho, hannah, ava]) {
  console.log(`  ${who.user.displayName.padEnd(14)} ${who.key}`);
}
console.log(`\n  Chanho ❤️ Hannah   ${BASE}/dm/${withHannah}`);
console.log(`  Chanho ❤️ Ava      ${BASE}/dm/${withAva}\n`);
console.log("  Each room already has both signatures, so its agent is registered on-chain.");
process.exit(0);
