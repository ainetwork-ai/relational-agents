import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aindriveLinks } from "@/lib/db/schema";
import { linkFromConfig, type AindriveLink } from "@/lib/aindrive";

/** The folder this person linked from Home, or null. A stored link this
 *  deployment no longer offers reads as none — it cannot be used. */
export async function userLink(userId: string): Promise<AindriveLink | null> {
  const [row] = await db.select().from(aindriveLinks).where(eq(aindriveLinks.userId, userId));
  if (!row) return null;
  try {
    return linkFromConfig({ driveId: row.driveId, root: row.root });
  } catch {
    return null;
  }
}
