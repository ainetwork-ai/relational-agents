import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { callUtterances, chatRoomMembers, users } from "@/lib/db/schema";

/**
 * Unlisted debug view of call_utterances. Not linked from anywhere — speech
 * from calls deliberately never surfaces in chat, so this is the only place to
 * read the table without a psql shell.
 *
 * It shipped without any of the guards below and reached production, where it
 * served every couple's call transcript, with speaker names, to anyone who
 * guessed the path — while `/` next to it redirected to login. Hence all three:
 *
 *  - gone entirely outside development, because a debug page has no business
 *    existing where real people's conversations are,
 *  - a session, because "unlisted" is not access control,
 *  - and rooms this user is actually a member of, because the whole product
 *    promise is that what was said belongs to the two who said it.
 */
export const dynamic = "force-dynamic";

export default async function UtterancesPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const session = await getSession();
  if (!session.userId) notFound();

  const memberships = await db
    .select({ roomId: chatRoomMembers.roomId })
    .from(chatRoomMembers)
    .where(eq(chatRoomMembers.userId, session.userId));
  const roomIds = memberships.map((m) => m.roomId);

  const rows = roomIds.length
    ? await db
        .select({
          id: callUtterances.id,
          roomId: callUtterances.roomId,
          callId: callUtterances.callId,
          speaker: users.displayName,
          speakerId: callUtterances.speakerId,
          text: callUtterances.text,
          processedAt: callUtterances.processedAt,
          createdAt: callUtterances.createdAt,
        })
        .from(callUtterances)
        .leftJoin(users, eq(users.id, callUtterances.speakerId))
        .where(inArray(callUtterances.roomId, roomIds))
        .orderBy(desc(callUtterances.createdAt))
        .limit(500)
    : [];

  const calls = new Set(rows.map((r) => r.callId)).size;
  const pending = rows.filter((r) => !r.processedAt).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 font-mono text-sm">
      <h1 className="text-base font-semibold">call_utterances</h1>
      <p className="mt-1 text-neutral-500">
        {rows.length} rows · {calls} calls · {pending} unprocessed · your rooms only
      </p>

      <div className="mt-6 overflow-x-auto rounded border border-neutral-200 dark:border-neutral-800">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="bg-neutral-100 text-left dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2 font-semibold">created_at</th>
              <th className="px-3 py-2 font-semibold">call_id</th>
              <th className="px-3 py-2 font-semibold">speaker</th>
              <th className="px-3 py-2 font-semibold">text</th>
              <th className="px-3 py-2 font-semibold">processed_at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                </td>
                <td className="px-3 py-2 text-neutral-500">{r.callId.slice(0, 8)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.speaker ?? r.speakerId.slice(0, 8)}</td>
                <td className="px-3 py-2 font-sans">{r.text}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {r.processedAt ? r.processedAt.toISOString().slice(11, 19) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-neutral-500" colSpan={5}>
                  No utterances in your rooms yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
