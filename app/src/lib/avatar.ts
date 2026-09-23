import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a person's face comes from when their row carries no avatar_url.
 *
 * Seeded people have a portrait on disk as
 * `public/avatars/<display name lowercased>.png`, and nothing ever wrote that
 * path into the users table — so the sidebar strip used to guess it in the
 * browser while every other surface fell back to a grey initial.
 *
 * Resolving it here instead, once, against the directory that actually exists,
 * is what lets every surface draw the same face without any of them guessing.
 * A client cannot know whether the file is there; it can only request the URL
 * and recover from the miss, and that miss is a 404 for every person who has
 * no portrait — which is most of them, including the signed-in user.
 *
 * SERVER ONLY: this reads the filesystem. Client components receive the
 * resolved value through `toPublicUser`, never by calling this.
 *
 * `public/avatars` is a runtime bind mount in production (uploads land there
 * while the app runs), so the listing is cached with a short TTL rather than
 * read once at boot.
 */
const DIR = join(process.cwd(), "public", "avatars");
const TTL_MS = 60_000;

let cached: Set<string> | null = null;
let readAt = 0;

function available(): Set<string> {
  const now = Date.now();
  if (cached && now - readAt < TTL_MS) return cached;
  try {
    cached = new Set(
      readdirSync(DIR)
        .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
        .map((f) => f.replace(/\.[^.]+$/, "").toLowerCase())
    );
  } catch {
   // no directory in this environment — everyone falls back to an initial
    cached = new Set();
  }
  readAt = now;
  return cached;
}

/** The face to draw for this person, or null to draw their initial. */
export function resolveAvatarUrl(
  displayName: string,
  avatarUrl?: string | null
): string | null {
  if (avatarUrl) return avatarUrl;
  const key = (displayName ?? "").trim().toLowerCase();
  if (!key || !available().has(key)) return null;
  return `/avatars/${encodeURIComponent(key)}.png`;
}
