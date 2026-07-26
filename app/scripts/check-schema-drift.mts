// Does this database have what the current build expects?
//
// The app reports the same thing at startup and on /api/health; this is the
// version you can point at any database without deploying to it:
//
//   POSTGRES_URL=… npx tsx --tsconfig scripts/tsconfig.json scripts/check-schema-drift.mts
//
// Exits non-zero when something is missing, so it can gate a deploy.
import { checkSchemaDrift, reportSchemaDrift } from "@/lib/db/schema-drift";

const drift = await checkSchemaDrift();
reportSchemaDrift(drift);
if (drift.ok) console.log("스키마 일치 ✓");
process.exit(drift.ok ? 0 : 1);
