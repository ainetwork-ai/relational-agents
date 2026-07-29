/**
 * Rehearses one line of the demo: asks a room's agent something and prints
 * what it would say, then removes both messages again.
 *
 *   pnpm demo:ask "Hannah" "@agent plan the egg tart date"
 *   pnpm demo:ask "Hannah" "@agent ..." --keep     # leave it in the transcript
 *
 * The probe runs the same path the room does (dispatch → respond), so a green
 * run here is the answer the audience gets. Nothing is left behind by default:
 * a demo transcript with rehearsal clutter in it is a demo you have to explain.
 */

// env first — @/lib/db opens its pool at import time
process.loadEnvFile?.(new URL("../.env.local", import.meta.url).pathname);

const { and, eq, gt } = await import("drizzle-orm");
const { db } = await import("../src/lib/db");
const { chatMessages, chatRooms, chatRoomMembers, users } = await import("../src/lib/db/schema");
const { dispatchToRoomBots } = await import("../src/lib/agent/dispatch");

const [roomArg, question, ...rest] = process.argv.slice(2);
const keep = rest.includes("--keep");
const quiet = rest.includes("--quiet");
if (!roomArg || !question) {
  console.error('usage: pnpm demo:ask <roomId | part of name> "<question>" [--keep] [--quiet]');
  process.exit(1);
}

const rooms = await db.select().from(chatRooms);
const room =
  rooms.find((r) => r.id === roomArg) ??
  rooms.filter((r) => r.name.toLowerCase().includes(roomArg.toLowerCase()))[0];
if (!room) {
  console.error(`No room matching "${roomArg}".`);
  process.exit(1);
}

const memberRows = await db
  .select({ userId: chatRoomMembers.userId })
  .from(chatRoomMembers)
  .where(eq(chatRoomMembers.roomId, room.id));
const members = (
  await Promise.all(
    memberRows.map(async (m) => (await db.select().from(users).where(eq(users.id, m.userId)))[0])
  )
).filter(Boolean);
const asker = members.find((u) => !u.isAgent && u.id === room.createdBy) ?? members.find((u) => !u.isAgent);
if (!asker) {
  console.error("No human member to ask as.");
  process.exit(1);
}

console.log(`room: ${room.name} (${room.id})`);
console.log(`asking as ${asker.displayName}${quiet ? " [quiet]" : ""}: ${question}\n`);

// processedAt is pre-stamped: a rehearsal question must not end up in the doc
const [probe] = await db
  .insert(chatMessages)
  .values({
    roomId: room.id,
    authorId: asker.id,
    text: question,
    attachments: [],
    privateToUserId: quiet ? asker.id : null,
    processedAt: new Date(),
  })
  .returning();

const started = Date.now();
await dispatchToRoomBots(room, probe);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

const replies = await db
  .select()
  .from(chatMessages)
  .where(and(eq(chatMessages.roomId, room.id), gt(chatMessages.createdAt, probe.createdAt)));
const agentReplies = [];
for (const r of replies) {
  const [u] = await db.select().from(users).where(eq(users.id, r.authorId));
  if (u?.isAgent) agentReplies.push(r);
}

if (!agentReplies.length) {
  console.log(`✗ no reply after ${elapsed}s`);
} else {
  for (const r of agentReplies) {
    console.log(`✓ reply in ${elapsed}s${r.privateToUserId ? " [quiet]" : ""}:\n${r.text}`);
    console.log(`attachments: ${JSON.stringify(r.attachments)}`);
  }
}

if (!keep) {
  for (const r of [probe, ...agentReplies])
    await db.delete(chatMessages).where(eq(chatMessages.id, r.id));
  console.log("\n(rehearsal messages removed)");
}
process.exit(0);
