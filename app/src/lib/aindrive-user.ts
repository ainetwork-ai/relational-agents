import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aindriveLinks } from "@/lib/db/schema";
import { parseLink, type AindriveLink } from "@/lib/aindrive";

/** The folder this person linked from Home, or null. Its calls run as the
 *  person's own aindrive account (runAs), which is what bounds it. */
export async function userLink(userId: string): Promise<AindriveLink | null> {
  const [row] = await db.select().from(aindriveLinks).where(eq(aindriveLinks.userId, userId));
  if (!row) return null;
  try {
    return parseLink({ driveId: row.driveId, root: row.root });
  } catch {
    return null;
  }
}
