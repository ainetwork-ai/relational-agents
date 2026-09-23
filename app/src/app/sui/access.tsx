import "server-only";
import Link from "next/link";
import { Lock } from "lucide-react";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatRoomMembers, chatRooms } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";

/**
 * Who may read this page.
 *
 * The page is about a memory that belongs to two people, so leaving it open to
 * the internet would have contradicted the thing it argues. Membership of the
 * relationship is the same check the room itself uses — the reader signed in
 * with the wallet that signed the contract, or they are not in this story.
 */
const DEMO_ROOM_ID =
  process.env.SUI_DEMO_ROOM_ID ?? "ea11a5b6-b715-452a-9340-6d946c353ba9";

export async function isRelationshipMember(): Promise<boolean> {
  const session = await getSession();
  if (!session.userId) return false;
  const [row] = await db
    .select({ userId: chatRoomMembers.userId })
    .from(chatRoomMembers)
    .where(
      and(
        eq(chatRoomMembers.roomId, DEMO_ROOM_ID),
        eq(chatRoomMembers.userId, session.userId)
      )
    )
    .limit(1);
  if (row) return true;
 // Anyone whose own relationship has been written to Sui belongs here too —
 // the page stops being a story about one couple and starts being their own
 // record the moment they have one.
  return Boolean(await myRelationshipOnSui());
}

export interface OwnRelationship {
  roomId: string;
  roomName: string;
  objectId: string;
  createTx: string | null;
}

/**
 * The viewer's own relationship, if consent has already put it on chain. Picks
 * the most recent one — a person may be in several, and the newest is the one
 * they just watched being born.
 */
export async function myRelationshipOnSui(): Promise<OwnRelationship | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const [row] = await db
    .select({
      roomId: chatRooms.id,
      roomName: chatRooms.name,
      objectId: chatRooms.suiObjectId,
      createTx: chatRooms.suiCreateTx,
    })
    .from(chatRooms)
    .innerJoin(chatRoomMembers, eq(chatRoomMembers.roomId, chatRooms.id))
    .where(
      and(
        eq(chatRoomMembers.userId, session.userId),
        isNotNull(chatRooms.suiObjectId)
      )
    )
    .orderBy(desc(chatRooms.createdAt))
    .limit(1);
  return row?.objectId
    ? { roomId: row.roomId, roomName: row.roomName, objectId: row.objectId, createTx: row.createTx }
    : null;
}

/** The refusal, told the same way the key servers tell it. */
export function NotAMember({ signedIn }: { signedIn: boolean }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-white px-6 text-neutral-800 dark:bg-[#191919] dark:text-neutral-200">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-800/60">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-700/60">
          <Lock size={18} />
        </span>
        <h1 className="mt-5 text-lg font-semibold">Not in this relationship</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          This page is one couple&apos;s memory and the proof that only they can
          open it. Reading it is the same permission as being in the room —
          which is the point, so we did not make an exception for the web.
        </p>
        <Link
          href={signedIn ? "/home" : "/login"}
          className="mt-6 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          {signedIn ? "Back to the app" : "Sign in with your wallet"}
        </Link>
      </div>
    </main>
  );
}

export async function sessionUserId(): Promise<string | null> {
  const session = await getSession();
  return session.userId ?? null;
}
