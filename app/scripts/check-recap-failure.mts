// The claim is what makes one call one entry — and it is also how a call can
// disappear: the lines are marked processed, and if the summary never gets
// written nothing looks at them again. These are the paths where that used to
// happen silently.
//
//   AI_URL=http://127.0.0.1:1 npx tsx --tsconfig scripts/tsconfig.json \
//     scripts/check-recap-failure.mts
//
// Inserts two utterances under a throwaway callId, drives writeCallRecap, and
// deletes them again. Nothing else in the room is touched.

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { callUtterances, chatRoomMembers, chatRooms } from "@/lib/db/schema";
import { writeCallRecap } from "@/lib/agent/call-watch";
import { docRootTitle } from "@/lib/agent/okf-docs";
import { DEFAULT_PROFILE } from "@/lib/agent/profiles";
import { nodeExists } from "@/lib/okf-store";

const ROOM = process.env.CALL_ROOM_ID ?? "81b6090e-1bb1-4ed1-ba0c-8152f0331573";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const [member] = await db
  .select({ userId: chatRoomMembers.userId })
  .from(chatRoomMembers)
  .where(eq(chatRoomMembers.roomId, ROOM));
if (!member) {
  console.error(`room ${ROOM} has no members`);
  process.exit(2);
}

const callId = randomUUID();
const claimed = new Date();
const inserted = await db
  .insert(callUtterances)
  .values([
    { roomId: ROOM, callId, speakerId: member.userId, text: "probe line one", processedAt: claimed },
    { roomId: ROOM, callId, speakerId: member.userId, text: "probe line two", processedAt: claimed },
  ])
  .returning();

try {
  // AI_URL points at a closed port, so aiChat throws — the old code returned
  // quietly here and the two lines stayed claimed forever.
  const res = await writeCallRecap(ROOM, callId, inserted);
  check("does not record when the LLM fails", res.recorded === false);

  const after = await db
    .select()
    .from(callUtterances)
    .where(and(eq(callUtterances.callId, callId)));
  check(
    "failed utterances go back to the queue",
    after.every((u) => u.processedAt === null),
    after.map((u) => String(u.processedAt)).join(", ")
  );

  // A room that never signed has no agent, so it cannot have a record either.
  // Fabricated lines are enough: the gate must return before touching them.
  const [unsigned] = await db
    .select()
    .from(chatRooms)
    .where(isNull(chatRooms.consentAt))
    .limit(1);
  if (unsigned) {
    const before = nodeExists(`${docRootTitle(unsigned.name, DEFAULT_PROFILE)}-${unsigned.id.slice(0, 6)}`);
    const res = await writeCallRecap(unsigned.id, randomUUID(), [
      { ...inserted[0], roomId: unsigned.id },
      { ...inserted[1], roomId: unsigned.id },
    ]);
    const after = nodeExists(`${docRootTitle(unsigned.name, DEFAULT_PROFILE)}-${unsigned.id.slice(0, 6)}`);
    check("an unsigned room does not create a document from a call alone", res.recorded === false && before === after,
      `${unsigned.name}: folder ${before ? "already exists" : "none"} → ${after ? "created" : "none"}`);
  } else {
    console.log("   (no unsigned room, so the consent gate is unverified)");
  }
} finally {
  await db.delete(callUtterances).where(eq(callUtterances.callId, callId));
  console.log("   probe rows deleted");
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
