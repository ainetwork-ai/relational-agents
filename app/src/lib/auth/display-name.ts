import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chatRoomBots,
  chatRoomMembers,
  chatRooms,
  users,
  workspaces,
  type User,
} from "@/lib/db/schema";
import { firstGlyphs } from "@/lib/glyph";

/**
 * `users.displayName` is the ONE global name for a person — every surface that
 * shows a human (member lists, message authors, mentions) renders this column,
 * so setting it once is visible to everyone.
 *
 * The catch is the copies. A relationship room's title, the agent named after
 * that room, and the personal workspace name are all built from the name at
 * creation time and then frozen — which is why a counterparty could still read
 * "User-0x…" long after you renamed yourself. `propagateDisplayName` rewrites
 * exactly those copies, and only while they still match what we generated
 * (anything a human renamed by hand is left alone).
 */

export const MAX_DISPLAY_NAME = 80;

export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().slice(0, MAX_DISPLAY_NAME);
  return name || null;
}

/** Name for a brand-new account when the caller supplied none. */
export function fallbackDisplayName(address: string): string {
  return `User-${address.slice(0, 8)}`;
}

/** Auto-generated 1:1 relationship room title — creator first. Single source of
 *  truth: room creation and rename propagation must agree byte-for-byte. */
export function relationshipRoomName(creator: string, partner: string): string {
  return `${creator} ❤️ ${partner}`;
}

/** Agent born from a room is named after it (see lib/agent/provision.ts). */
function agentNameFor(roomName: string): string {
  return `${roomName} agent`;
}

function workspaceNameFor(displayName: string): string {
  return `${displayName}'s Workspace`;
}

/**
 * Set the global name and refresh every frozen copy of it. Returns the updated
 * row, or null if the user is gone / the name is empty.
 */
export async function setUserDisplayName(
  userId: string,
  raw: unknown
): Promise<User | null> {
  const name = normalizeDisplayName(raw);
  if (!name) return null;

  const [before] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!before) return null;
  if (before.displayName === name) return before;

  const [after] = await db
    .update(users)
    .set({ displayName: name })
    .where(eq(users.id, userId))
    .returning();
  if (!after) return null;

  // Best-effort: a failed copy must not fail the rename itself.
  try {
    await propagateDisplayName(userId, before.displayName, name);
  } catch (err) {
    console.error("display name propagation failed:", err);
  }
  return after;
}

/**
 * Login-time rename. The login form is the only place that offers a name, so a
 * returning user typing a different one IS the rename gesture — every wallet
 * path (AIN, MetaMask, raw key) honours it, not just the first sign-up.
 */
export async function applyLoginDisplayName(user: User, provided: unknown): Promise<User> {
  const name = normalizeDisplayName(provided);
  if (!name || name === user.displayName) return user;
  return (await setUserDisplayName(user.id, name)) ?? user;
}

export interface PropagationResult {
  rooms: number;
  agents: number;
  workspaces: number;
}

/**
 * Rewrite the names that were copied from `oldName` at creation time. Call
 * AFTER the users row already holds `newName` — partners' names are read live,
 * so the rebuilt title is current for everyone in the room.
 */
export async function propagateDisplayName(
  userId: string,
  oldName: string,
  newName: string
): Promise<PropagationResult> {
  const result: PropagationResult = { rooms: 0, agents: 0, workspaces: 0 };
  if (oldName === newName) return result;

  result.workspaces = await renamePersonalWorkspaces(userId, oldName, newName);

  const myRoomIds = (
    await db
      .select({ roomId: chatRoomMembers.roomId })
      .from(chatRoomMembers)
      .where(eq(chatRoomMembers.userId, userId))
  ).map((r) => r.roomId);
  if (!myRoomIds.length) return result;

  // directKey is set only on 1:1 relationship rooms — the ones whose title we
  // generate. Group rooms are titled by their creator, never auto-named.
  const rooms = await db
    .select({ id: chatRooms.id, name: chatRooms.name, createdBy: chatRooms.createdBy })
    .from(chatRooms)
    .where(and(inArray(chatRooms.id, myRoomIds), isNotNull(chatRooms.directKey)));
  if (!rooms.length) return result;

  const roomIds = rooms.map((r) => r.id);
  // Humans only: the room's agent is a chat_room_members row too (provision.ts
  // adds it), and picking it as "the partner" would break the title rebuild.
  const memberRows = await db
    .select({
      roomId: chatRoomMembers.roomId,
      userId: users.id,
      displayName: users.displayName,
    })
    .from(chatRoomMembers)
    .innerJoin(users, eq(users.id, chatRoomMembers.userId))
    .where(and(inArray(chatRoomMembers.roomId, roomIds), eq(users.isAgent, false)));
  const byRoom = new Map<string, { userId: string; displayName: string }[]>();
  for (const row of memberRows) {
    const list = byRoom.get(row.roomId) ?? [];
    list.push({ userId: row.userId, displayName: row.displayName });
    byRoom.set(row.roomId, list);
  }

  const botRows = await db
    .select({ roomId: chatRoomBots.roomId, agentUserId: chatRoomBots.agentUserId })
    .from(chatRoomBots)
    .where(inArray(chatRoomBots.roomId, roomIds));
  const botsByRoom = new Map<string, string[]>();
  for (const b of botRows) {
    botsByRoom.set(b.roomId, [...(botsByRoom.get(b.roomId) ?? []), b.agentUserId]);
  }

  for (const room of rooms) {
    const members = byRoom.get(room.id) ?? [];
    const creator = members.find((m) => m.userId === room.createdBy);
    const partner = members.find((m) => m.userId !== room.createdBy);
    if (!creator || !partner) continue; // agent-only / broken membership

    // Rebuild the title as it read BEFORE the rename. Mismatch = a human
    // renamed this room, so leave it be.
    const nameBefore = (m: { userId: string; displayName: string }) =>
      m.userId === userId ? oldName : m.displayName;
    const stale = relationshipRoomName(nameBefore(creator), nameBefore(partner));
    if (room.name !== stale) continue;

    const fresh = relationshipRoomName(creator.displayName, partner.displayName);
    await db.update(chatRooms).set({ name: fresh }).where(eq(chatRooms.id, room.id));
    result.rooms += 1;

    const agentIds = botsByRoom.get(room.id) ?? [];
    if (agentIds.length) {
      const agents = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(and(inArray(users.id, agentIds), eq(users.isAgent, true)));
      for (const agent of agents) {
        if (agent.displayName !== agentNameFor(stale)) continue; // renamed by hand
        await db
          .update(users)
          .set({ displayName: agentNameFor(fresh) })
          .where(eq(users.id, agent.id));
        result.agents += 1;
      }
    }
  }

  return result;
}

/** The personal workspace ensureWorkspace() named after the user. */
async function renamePersonalWorkspaces(
  userId: string,
  oldName: string,
  newName: string
): Promise<number> {
  const oldBase = workspaceNameFor(oldName);
  // ensureWorkspace suffixes with a short id when the name is taken
  const oldSuffixed = `${oldBase} ${userId.slice(0, 6)}`;
  const mine = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.createdBy, userId));

  let renamed = 0;
  for (const ws of mine) {
    if (ws.name !== oldBase && ws.name !== oldSuffixed) continue;
    const base = workspaceNameFor(newName);
    const target = ws.name === oldBase ? base : `${base} ${userId.slice(0, 6)}`;
    const patch = { iconText: firstGlyphs(newName, 2).toUpperCase() };
    try {
      await db.update(workspaces).set({ ...patch, name: target }).where(eq(workspaces.id, ws.id));
      renamed += 1;
    } catch {
      // workspaces.name is globally unique — fall back to the suffixed form,
      // and if that is taken too, keep the old name (cosmetic either way).
      try {
        await db
          .update(workspaces)
          .set({ ...patch, name: `${base} ${userId.slice(0, 6)}` })
          .where(eq(workspaces.id, ws.id));
        renamed += 1;
      } catch {
        await db.update(workspaces).set(patch).where(eq(workspaces.id, ws.id));
      }
    }
  }
  return renamed;
}
