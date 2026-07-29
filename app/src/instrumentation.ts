/**
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * Only the schema check lives here so far: a build can reach a database that
 * never got `drizzle-kit push`, and without this the first sign is a failing
 * request somewhere unrelated. Boot is when someone is actually watching the
 * log, so that is where it belongs.
 *
 * It never blocks startup. A missing column breaks some routes, not all of
 * them, and refusing to serve the rest helps nobody.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { checkSchemaDrift, reportSchemaDrift } = await import("@/lib/db/schema-drift");
    reportSchemaDrift(await checkSchemaDrift());
  } catch (err) {
    console.error("schema drift check failed to run:", err);
  }
}
