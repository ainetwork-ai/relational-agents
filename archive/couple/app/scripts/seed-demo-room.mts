/**
 * Makes a DM room demo-ready: the agent ends up with an actual relationship
 * document to answer from.
 *
 *   pnpm demo:seed <roomId | part of the room name> [options]
 *     --as <name>     who drives the demo (default: whoever opened the room);
 *                     the OTHER member is the one the sunset story belongs to
 *     --reset         forget the doc and re-read the whole chat from scratch
 *     --no-sunsets    skip the sunset fixture — for a room whose own history
 *                     already carries the story
 *
 * Three things, in order:
 *  1. widen the harvest window — the pipeline only reads messages newer than
 *     `consentAt`, so a room whose history was back-dated (every demo fixture)
 *     has a chat full of memories the agent can never see;
 *  2. organize — the real pipeline, writing the doc from that chat;
 *  3. seed the sunset story the Belém Tower recommendation is grounded in.
 *
 * Without this the agent is not broken, it is empty: it answers only from the
 * document and correctly says it has nothing to go on. Idempotent.
 */

// env first — @/lib/db opens its pool at import time
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const fs = await import("node:fs");
const path = await import("node:path");
const { asc, eq } = await import("drizzle-orm");
const { db } = await import("../src/lib/db");
const { agentRoomStates, chatMessages, chatRooms, chatRoomMembers, users } = await import(
  "../src/lib/db/schema"
);
const { runPipeline } = await import("../src/lib/agent/pipeline");
const { seedSunsetStory } = await import("../src/lib/demo/seed-sunsets");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const roomArg = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--as");
if (!roomArg) {
  console.error("usage: pnpm demo:seed <roomId | part of room name> [--as <name>] [--reset] [--no-sunsets]");
  process.exit(1);
}

const rooms = await db.select().from(chatRooms);
const room =
  rooms.find((r) => r.id === roomArg) ??
  rooms.filter((r) => r.name.toLowerCase().includes(roomArg.toLowerCase()))[0];
if (!room) {
  console.error(`No room matching "${roomArg}". Rooms:`);
  for (const r of rooms) console.error(`  ${r.id}  ${r.name}`);
  process.exit(1);
}
console.log(`room: ${room.name} (${room.id})`);

// 1. the room's own history has to fall inside the harvest window
const [oldest] = await db
  .select({ createdAt: chatMessages.createdAt })
  .from(chatMessages)
  .where(eq(chatMessages.roomId, room.id))
  .orderBy(asc(chatMessages.createdAt))
  .limit(1);
if (oldest && (!room.consentAt || room.consentAt > oldest.createdAt)) {
  const consentAt = new Date(oldest.createdAt.getTime() - 1000);
  await db.update(chatRooms).set({ consentAt }).where(eq(chatRooms.id, room.id));
  console.log(`consentAt: ${room.consentAt?.toISOString() ?? "(none)"} → ${consentAt.toISOString()}`);
} else {
  console.log(`consentAt: ${room.consentAt?.toISOString()} (already covers the history)`);
}

// optional: throw the document away and read the chat again from the start
if (flag("--reset")) {
  const [state] = await db.select().from(agentRoomStates).where(eq(agentRoomStates.roomId, room.id));
  const root = process.env.OKF_ROOT ?? "";
  for (const [key, rel] of Object.entries(state?.sectionOkfPaths ?? {})) {
    const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
    try {
      const text = fs.readFileSync(abs, "utf8");
      const head = text.match(/^---[\s\S]*?---\n(#[^\n]*\n)?/);
      if (head) fs.writeFileSync(abs, head[0].endsWith("\n") ? head[0] : `${head[0]}\n`);
      console.log(`reset: ${key}`);
    } catch {
      // a section with no file yet is already as empty as it gets
    }
  }
  await db
    .update(chatMessages)
    .set({ processedAt: null, recordedAt: null })
    .where(eq(chatMessages.roomId, room.id));
  console.log("reset: every message is unread again");
}

// 2. organize — one run caps at 200 messages, so loop until it stops finding work
for (let pass = 1; pass <= 3; pass++) {
  const result = await runPipeline(room.id);
  console.log(`organize pass ${pass}: ${JSON.stringify(result)}`);
  if (result.skipped || !result.processed) break;
}

// 3. the sunset evidence behind the Belém Tower recommendation
if (flag("--no-sunsets")) {
  console.log("sunsets: skipped");
  process.exit(0);
}
const memberRows = await db
  .select({ userId: chatRoomMembers.userId })
  .from(chatRoomMembers)
  .where(eq(chatRoomMembers.roomId, room.id));
const members = (
  await Promise.all(
    memberRows.map(async (m) => (await db.select().from(users).where(eq(users.id, m.userId)))[0])
  )
).filter((u) => u && !u.isAgent);
const wanted = opt("--as")?.toLowerCase();
const actor =
  (wanted && members.find((u) => u.displayName.toLowerCase().includes(wanted))) ??
  members.find((u) => u.id === room.createdBy) ??
  members[0];
if (!actor) {
  console.error(`Room "${room.name}" has no human members — cannot seed.`);
  process.exit(1);
}
if (wanted && !actor.displayName.toLowerCase().includes(wanted))
  console.warn(`no member matching "--as ${wanted}" — driving as ${actor.displayName}`);
console.log(`driver: ${actor.displayName}`);
console.log(`sunsets: ${JSON.stringify(await seedSunsetStory(room.id, room.name, actor.id))}`);
process.exit(0);
