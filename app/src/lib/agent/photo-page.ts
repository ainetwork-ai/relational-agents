import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamspaces } from "@/lib/db/schema";
import { aiChat } from "@/lib/ai";
import { runAsOrService } from "@/lib/aindrive-account";
import { aindrivePublicBase, listTree, notUserFolder } from "@/lib/aindrive";
import { aindriveFileUrl } from "@/lib/aindrive-url";
import { makeT } from "@/i18n/translate";
import { familyDemo } from "@/i18n/content/demo-lang";
import { FAMILY_FILES, PHOTO_PAGE_WORDS, anyOf } from "@/i18n/content/agent";
import { b, writeAgentPage, type NewBlock } from "./agent-pages";
import { PHOTO_RE, captionPhotos } from "./photo-captions";
import type { DriveSource } from "./shared-drives";

/**
 * "Make a page with the tree photos": every photo on the family's shared
 * phones is looked at (photo-captions.ts), the model picks the ones that show
 * what was asked for, and they become one page in the teamspace they came
 * from. Unlike the album (family-skills.ts), which sorts a trip by date and
 * place, this goes by what is in the picture.
 */

const TOPIC = anyOf(PHOTO_PAGE_WORDS.topic);
const ACT = anyOf(PHOTO_PAGE_WORDS.act);
const FORWARDED = anyOf(FAMILY_FILES.forwarded);
const MAX_PHOTOS = 60;

export function matchPhotoPage(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  return TOPIC.test(t) && ACT.test(t);
}

interface Ctx {
  workspaceId: string;
  askerId: string;
  sources: DriveSource[];
  text: string;
  lang: "ko" | "en";
  /** an interim line in the chat — looking at photos the first time takes a while */
  say?: (line: string) => Promise<unknown>;
}

interface Photo {
  src: DriveSource;
  rel: string;
  full: string;
  caption: string;
}

const nameOf = (p: string) => p.split("/").pop() ?? p;
const place = (rel: string) => nameOf(rel).replace(/\.[^.]+$/, "").replace(/_/g, " ");

export async function photoPage(ctx: Ctx): Promise<{ text: string; pageId?: string }> {
  const t = makeT(ctx.lang);
  const nm = (name: string) => (ctx.lang === "en" ? (familyDemo().FAMILY_NAME_EN[name] ?? name) : name);
  const who = (src: DriveSource) => nm(src.ownerName ?? src.label);

  const off: string[] = [];
  const listed = await Promise.all(
    ctx.sources.map(async (src) => {
      const files = await runAsOrService(src.linkedBy, () => listTree(src.link, 400, 80, notUserFolder)).catch(() => {
        off.push(who(src));
        return [] as string[];
      });
      return files.filter((rel) => PHOTO_RE.test(rel)).map((rel) => ({ src, rel }));
    })
  );
  const found = listed.flat().slice(0, MAX_PHOTOS);
  // one name per person, however many of their folders were shared
  const offNote = off.length ? "\n⚠️ " + t("{names} did not answer, so their photos are not included.", { names: [...new Set(off)].join(", ") }) : "";
  if (!found.length) return { text: t("There are no photos in the folders the family shared.") + offNote };

  await ctx.say?.(t("Looking through {n} photos from the family's phones…", { n: found.length }));
  const captions = await captionPhotos(found);
  // the same photo sent around the family reads the same — keep the copy on the phone that took it
  const byCaption = new Map<string, Photo>();
  for (const [i, f] of found.entries()) {
    const caption = captions[i];
    if (!caption) continue;
    const photo = { ...f, full: [f.src.link.root, f.rel].filter(Boolean).join("/"), caption };
    const prev = byCaption.get(caption);
    if (!prev || (FORWARDED.test(nameOf(prev.rel)) && !FORWARDED.test(nameOf(f.rel)))) byCaption.set(caption, photo);
  }
  const photos = [...byCaption.values()];
  if (!photos.length) return { text: t("I couldn't open any of the family's photos just now — try again in a moment.") + offNote };

  const language = ctx.lang === "en" ? "English" : "Korean";
  const list = photos.map((p, i) => `[${i}] ${who(p.src)}'s phone · ${p.rel}\n    ${p.caption}`).join("\n");
  const raw = await aiChat(
    [
      {
        role: "system",
        content:
          `You pick photos for a page a family member asked for. Each photo below has been looked at and described. ` +
          `Pick every photo that clearly shows what the request asks for — it counts when it is plainly visible anywhere in the picture, not only as the main subject ` +
          `(trees: a forest, an orchard, a tree-lined lane or trees behind the people all count). Pick none rather than guess.\n` +
          `Output JSON only: {"subject":"<what the photos should show, a few words>","title":"<page title>","intro":"<one warm sentence for the top of the page>",` +
          `"picks":[{"i":<number>,"note":"<what in this photo matches, a few words>"}]}. Write subject, title, intro and notes in ${language}.`,
      },
      { role: "user", content: `Request: ${ctx.text}\n\nPhotos:\n${list}` },
    ],
    { maxTokens: 1_200, temperature: 0 }
  ).catch(() => "");
  let plan: { subject?: string; title?: string; intro?: string; picks?: { i?: unknown; note?: unknown }[] } = {};
  try {
    const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    plan = JSON.parse((fenced ? fenced[1] : raw).trim().replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
  } catch {
    return { text: t("I looked at {n} photos but couldn't sort them just now — ask me once more?", { n: photos.length }) + offNote };
  }
  const subject = typeof plan.subject === "string" && plan.subject.trim() ? plan.subject.trim() : t("what you asked for");
  const seen = new Set<number>();
  const picks = (Array.isArray(plan.picks) ? plan.picks : [])
    .map((x) => ({ i: Number(x?.i), note: typeof x?.note === "string" ? x.note.trim() : "" }))
    .filter((x) => Number.isInteger(x.i) && x.i >= 0 && x.i < photos.length && !seen.has(x.i) && seen.add(x.i));
  if (!picks.length)
    return {
      text:
        t("I looked at all {n} photos on the family's phones and none of them show {subject}.", { n: photos.length, subject }) +
        "\n" +
        t("What they do show: {list}", { list: photos.slice(0, 6).map((p) => place(p.rel)).join(", ") }) +
        offNote,
    };

  const first = photos[picks[0].i];
  const tsId = first.src.teamspaceId;
  const [ts] = tsId
    ? await db.select().from(teamspaces).where(eq(teamspaces.id, tsId))
    : await db.select().from(teamspaces).where(eq(teamspaces.workspaceId, ctx.workspaceId)).limit(1);
  if (!ts) return { text: t("I couldn't find the teamspace the photos are in.") };

  const base = aindrivePublicBase() ?? "";
  const phones = [...new Set(picks.map((x) => who(photos[x.i].src)))];
  const title = typeof plan.title === "string" && plan.title.trim() ? plan.title.trim().slice(0, 80) : t("Photos: {subject}", { subject });
  const intro = typeof plan.intro === "string" && plan.intro.trim() ? plan.intro.trim() : "";
  const body: NewBlock[] = [
    b.callout(
      "🖼️",
      [intro, t("{n} photos from {phones}'s phones, picked by what is in them.", { n: picks.length, phones: phones.join(" · ") })]
        .filter(Boolean)
        .join(" ")
    ),
    // one grid of photos (album-grid.tsx), each opening full size
    {
      type: "file",
      content: {
        files: picks.map(({ i, note }) => {
          const p = photos[i];
          return {
            url: aindriveFileUrl(base, { driveId: p.src.link.driveId, path: p.full }),
            text: `${place(p.rel)} — ${t("{who}'s phone", { who: who(p.src) })}${note ? ` · ${note}` : ""}`,
          };
        }),
      },
    },
  ];
  const pageId = await writeAgentPage({ workspaceId: ctx.workspaceId, teamspaceId: ts.id, title, icon: "🖼️", byUserId: ctx.askerId, blocks: body, fullWidth: true });
  return {
    pageId,
    text:
      t("Made 「{title}」 → /p/{pageId}", { title, pageId }) +
      "\n" +
      t("{n} of {total} photos show {subject}:", { n: picks.length, total: photos.length, subject }) +
      "\n" +
      picks.map(({ i, note }) => `- ${place(photos[i].rel)} (${who(photos[i].src)})${note ? ` — ${note}` : ""}`).join("\n") +
      offNote,
  };
}
