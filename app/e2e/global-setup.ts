import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Create a throwaway, git-ignored OKF root so the agent write-pipeline (the
 * "It remembers" scene) can create/mutate relationship docs without touching a
 * real content tree. playwright.config points OKF_ROOT at it. The specs seed
 * whatever docs they need, so it starts empty.
 *
 * DB is the SHARED demo Postgres (other sessions use it too) — global setup is
 * deliberately NON-destructive: it only clears the OKF schema overlay for THIS
 * throwaway root. It must never DELETE app rows (rooms, messages, users), or it
 * would wipe another session's demo data.
 */
export default async function globalSetup() {
  const dst = path.resolve(__dirname, ".okf-work");
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });

  const env = fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8");
  const url = env.match(/^POSTGRES_URL=(.+)$/m)?.[1]?.trim();
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    // file copy alone no longer resets db-held OKF schema — clear the overlay
    // for THIS root only (scoped to the throwaway path, harms no shared data).
    await client.query("DELETE FROM okf_db_meta WHERE root = $1", [dst]).catch(() => {});
  } catch {
    // table may not exist yet (fresh db) — nothing to clear
  } finally {
    await client.end().catch(() => {});
  }
}
