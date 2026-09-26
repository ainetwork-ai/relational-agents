import "server-only";
import { aiChat } from "@/lib/ai";
import { runAsOrService } from "@/lib/aindrive-account";
import { readFileBytes } from "@/lib/aindrive";
import type { DriveSource } from "./shared-drives";

/**
 * What is IN a photo on a shared phone, in one sentence — so "photos of
 * trees" can be answered at all. A file name says where a photo was taken
 * ("Hallasan_Yeongsil_trail.jpg"), never what it shows; the model can look at
 * the picture (gemma-4 is multimodal), so it does, once per photo.
 *
 * Kept in memory per server process, keyed by drive + path: a restart looks
 * again (≈2 s a photo). The first question over a new folder waits for it; the
 * chat's file list only shows captions already made and warms the rest.
 */

export const PHOTO_RE = /\.(jpe?g|png|webp)$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 3;

type Entry = { src: DriveSource; rel: string };

const KEY = Symbol.for("app.agent.photoCaptions");
function cache(): Map<string, Promise<string | null>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<string | null>>>;
  return (g[KEY] ??= new Map());
}
const done = new Map<string, string>();
const keyOf = (e: Entry) => `${e.src.link.driveId}:${[e.src.link.root, e.rel].filter(Boolean).join("/")}`;

const mime = (rel: string) => {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jpg" ? "image/jpeg" : `image/${ext}`;
};

async function look(e: Entry): Promise<string | null> {
  const bytes = await runAsOrService(e.src.linkedBy, () => readFileBytes(e.src.link, e.rel, MAX_BYTES)).catch(() => null);
  if (!bytes) return null;
  const raw = await aiChat(
    [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Describe this photo in one plain English sentence: what is in it (people, trees, flowers, food, sea, buildings, animals…) and the setting. " +
              "Then a line 'Tags:' with 5-10 lowercase comma-separated nouns. Nothing else.",
          },
          { type: "image_url", image_url: { url: `data:${mime(e.rel)};base64,${bytes.toString("base64")}` } },
        ],
      },
    ],
    { maxTokens: 120, temperature: 0, timeoutMs: 60_000 }
  ).catch(() => "");
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 400) : null;
}

/** The photo's caption, looked at now if it has not been yet (null: unreadable). */
export function captionPhoto(e: Entry): Promise<string | null> {
  const k = keyOf(e);
  let p = cache().get(k);
  if (!p) {
    p = look(e).then((c) => {
      if (c) done.set(k, c);
      else cache().delete(k); // a phone that was off may answer next time
      return c;
    });
    cache().set(k, p);
  }
  return p;
}

/** Captions for many photos, a few at a time; same order as `entries`. */
export async function captionPhotos(entries: Entry[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(entries.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, entries.length) }, async () => {
      while (next < entries.length) {
        const i = next++;
        out[i] = await captionPhoto(entries[i]);
      }
    })
  );
  return out;
}

/** The caption when one is already made — never waits. */
export function knownCaption(e: Entry): string | null {
  return done.get(keyOf(e)) ?? null;
}

/** Start looking at these photos in the background (what the next question will want). */
export function warmCaptions(entries: Entry[]): void {
  const todo = entries.filter((e) => !cache().has(keyOf(e)));
  if (todo.length) void captionPhotos(todo).catch(() => {});
}
