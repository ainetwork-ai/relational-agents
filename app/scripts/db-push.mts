// Non-interactive, guarded schema push. `drizzle-kit push` insists on a TTY
// for its prompts; this uses the programmatic API instead and REFUSES to run
// anything destructive (DROP TABLE / DROP COLUMN) — additive changes only.
//
//   POSTGRES_URL=postgres://… npx tsx --tsconfig scripts/tsconfig.json scripts/db-push.mts
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../src/lib/db/schema";

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
const db = drizzle(pool);
const { statementsToExecute, apply } = await pushSchema(schema, db as never);
const destructive = statementsToExecute.filter((s) => /\bDROP\s+(TABLE|COLUMN)\b/i.test(s));
console.log(`${statementsToExecute.length} statements, ${destructive.length} destructive`);
if (destructive.length) {
  console.error("REFUSING — destructive statements:\n" + destructive.join("\n"));
  process.exit(2);
}
for (const s of statementsToExecute) console.log("  " + s.slice(0, 110));
await apply();
console.log("applied");
await pool.end();
