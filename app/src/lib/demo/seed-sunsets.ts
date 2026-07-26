import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileForRoom } from "@/lib/agent/profiles";
import { agentRoomStates, chatMessages, chatRoomMembers, users } from "@/lib/db/schema";
import { ensureOkfDocTree, appendOkfLines, okfDocMeta } from "@/lib/agent/okf-docs";

/**
 * Demo fixture: back-fill a room with the story evidence the finale needs —
 * the other member's sunset photos (golden-hour spam) plus her "I love
 * sunsets" line, and the corresponding People-notes / Open-topics entries the
 * agent grounds its Belém Tower recommendation in. Idempotent per room.
 *
 * The agent answers only from the relationship document, so an unseeded room
 * makes it say "I have nothing to go on" — correct behaviour, dead demo.
 */

const MAPS_URL = "https://maps.app.goo.gl/Nir82uC1c9UQTQtd7";
const TOWER_IMG = "/uploads/belem-tower.jpg";
const SUNSETS = ["/uploads/sunset-1.jpg", "/uploads/sunset-2.jpg", "/uploads/sunset-3.jpg", "/uploads/sunset-4.jpg"];
const MARKER = "I love sunsets";

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  messages?: number;
  sunsetLover?: string;
}

/** `actorUserId` is the member the sunset photos are sent TO (the demo driver). */
export async function seedSunsetStory(
  roomId: string,
  roomName: string,
  actorUserId: string
): Promise<SeedResult> {
  // the other HUMAN member is the sunset lover (demo: Ava)
  const memberRows = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(and(eq(chatRoomMembers.roomId, roomId), ne(chatRoomMembers.userId, actorUserId)));
  const other = (
    await Promise.all(
      memberRows.map(async (m) => (await db.select().from(users).where(eq(users.id, m.userId)))[0])
    )
  ).find((u) => u && !u.isAgent);
  if (!other) return { seeded: false, reason: "No other human member to seed as" };

  // idempotency: if her sunset line is already in the room, do nothing
  const existing = await db
    .select({ id: chatMessages.id, text: chatMessages.text })
    .from(chatMessages)
    .where(eq(chatMessages.roomId, roomId));
  if (existing.some((m) => m.text.includes(MARKER))) return { seeded: false, reason: "already seeded" };

  // a golden-hour week, backdated so it reads as history
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const seedMsgs: { authorId: string; text: string; attachments?: { url: string; name: string }[]; createdAt: Date; processedAt: Date }[] = [
    { authorId: other.id, text: "golden hour again 🌇", attachments: [{ url: SUNSETS[0], name: "sunset.jpg" }], createdAt: new Date(now - 6 * day), processedAt: new Date() },
    { authorId: other.id, text: "caught this on my walk home", attachments: [{ url: SUNSETS[1], name: "sunset.jpg" }], createdAt: new Date(now - 5 * day), processedAt: new Date() },
    { authorId: actorUserId, text: "you and your skies 😄", createdAt: new Date(now - 5 * day + 60_000), processedAt: new Date() },
    { authorId: other.id, text: `${MARKER} — best part of my day, every day`, attachments: [{ url: SUNSETS[2], name: "sunset.jpg" }], createdAt: new Date(now - 3 * day), processedAt: new Date() },
    { authorId: other.id, text: "tonight's was unreal 🧡", attachments: [{ url: SUNSETS[3], name: "sunset.jpg" }], createdAt: new Date(now - day), processedAt: new Date() },
  ];
  await db.insert(chatMessages).values(seedMsgs.map((m) => ({ ...m, roomId })));

  // ground the agent: the preference (People notes) + the reusable rec (Open topics)
  const [state] = await db.select().from(agentRoomStates).where(eq(agentRoomStates.roomId, roomId));
 // the demo room is a romance; the seed writes into that profile's sections
  const profile = await profileForRoom(roomId);
  const tree = ensureOkfDocTree(roomId, roomName, profile, {
    rootPath: state?.rootOkfPath,
    sectionPaths: state?.sectionOkfPaths,
  });
  appendOkfLines(
    tree.sectionPaths["people"],
    "People notes",
    [
      {
        type: "bulleted_list",
        text: `${other.displayName} — loves sunsets ("${MARKER} — best part of my day"); keeps sharing golden-hour photos in chat.`,
      },
    ],
    okfDocMeta(roomId, profile, "people")
  );
  appendOkfLines(
    tree.sectionPaths["open-topics"],
    "Open topics",
    [
      {
        type: "bulleted_list",
        text:
          `Date idea — Belém Tower at sunset. Why: the sun setting over the Tagus river pairs with the tower for a romantic mood — and ${other.displayName} loves sunsets (see People notes). ` +
          `Map: ${MAPS_URL} Image: ${TOWER_IMG}`,
      },
      { type: "image", text: "Belém Tower at sunset", url: TOWER_IMG },
    ],
    okfDocMeta(roomId, profile, "open-topics")
  );

  return { seeded: true, messages: seedMsgs.length, sunsetLover: other.displayName };
}
