import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Copy the repo's OKF content into a throwaway, git-ignored working copy so the
 * agent write-pipeline (the "It remembers" scene) can create/mutate relationship
 * docs without dirtying the real memory-data/. playwright.config points OKF_ROOT
 * at this working copy.
 *
 * DB is the SHARED demo Postgres (other sessions use it too) — global setup is
 * deliberately NON-destructive: it only clears the OKF schema overlay for THIS
 * throwaway root. It must never DELETE app rows (rooms, messages, users), or it
 * would wipe another session's demo data.
 */
export default async function globalSetup() {
  const src = path.resolve(__dirname, "../../memory-data/content");
  const dst = path.resolve(__dirname, ".okf-work");
  fs.rmSync(dst, { recursive: true, force: true });
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
  } else {
    fs.mkdirSync(dst, { recursive: true });
  }

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
