import { db } from "@/lib/db";
import { databases, workspaceMembers } from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/** Returns the database iff the user belongs to its workspace, else null. */
export async function loadDatabaseForUser(
  databaseId: string,
  userId: string
): Promise<Database | null> {
  const [database] = await db
    .select()
    .from(databases)
    .where(eq(databases.id, databaseId))
    .limit(1)
    .catch(() => []);
  if (!database) return null;
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, database.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return member ? database : null;
}
