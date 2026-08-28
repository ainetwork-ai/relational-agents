import path from "node:path";

/**
 * Where partial uploads are staged. Deliberately NOT under public/ — a
 * half-written file must never be reachable by URL.
 *
 * Its own module so finalize-upload can read it without importing the tus
 * server (which would pull @tus/server into anything that touches finalizing).
 */
export const TUS_LOCAL_DIRECTORY = path.join(process.cwd(), ".uploads-tus");
