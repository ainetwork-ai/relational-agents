"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Rose scale per emotion level (Lv.0 🩶 … Lv.7 💝) — matches the
 * relationship dashboard's badge palette. */
const LEVEL_FILL = [
  "#f4f4f5", "#ffe4e6", "#fecdd3", "#fda4af",
  "#fb7185", "#f43f5e", "#e11d48", "#be123c",
];

const INDEX_TITLE = "Relationship Records";

interface Person {
  key: string;
  name: string;
  level: number; // -1 = unknown (no Relationships DB)
  pageId: string; // record page to open (fallback)
  roomId: string | null; // 1:1 DM room with this person, when one exists
}

interface DmRoomRow {
  id: string;
  members: { displayName: string; isAgent: boolean }[];
}

interface PageRow {
  id: string;
  title: string;
  parentPageId: string | null;
  isArchived: boolean;
}

/** "❤️ Sophie Miller" / "Chanho ❤️ Sophie Miller" → "sophie miller" */
const nameKey = (t: string) =>
  t.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();

/** Record pages are titled "<me> ❤️ <partner>" (or just "❤️ <partner>") —
 * the face belongs to the partner, i.e. the last emoji-separated segment. */
const partnerOf = (title: string) => {
  const segs = title
    .split(/[^\p{L}\p{N} ]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.length ? segs[segs.length - 1] : title.trim();
};

function HeartBadge({ level }: { level: number }) {
  const fill = LEVEL_FILL[Math.max(0, Math.min(level, LEVEL_FILL.length - 1))] ?? LEVEL_FILL[0];
  return (
    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white dark:bg-neutral-900">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-label={`Level ${level}`}>
        <path
          d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
          fill={fill}
          stroke="rgba(136,19,55,.45)"
          strokeWidth="1.4"
        />
      </svg>
    </span>
  );
}

function Face({ person }: { person: Person }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <span className="relative flex h-11 w-11 items-center justify-center">
      {imgOk ? (
 // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/avatars/${person.key}.png`}
          alt={person.name}
          onError={() => setImgOk(false)}
          className="h-11 w-11 rounded-full object-cover shadow-sm ring-1 ring-black/5 dark:ring-white/10"
        />
      ) : (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-200 text-base font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
          {person.name.charAt(0).toUpperCase()}
        </span>
      )}
      {person.level >= 0 && <HeartBadge level={person.level} />}
    </span>
  );
}

/** Sidebar Chats tab, horizontal people strip:
 * round faces with a level heart badge, sourced from the "Relationship
 * Records" index page's children; levels come from the "Relationships"
 * database when one exists. Hidden entirely when the index page is absent. */
export function RelationshipsStrip() {
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pagesRes = await fetch("/api/pages");
        if (!pagesRes.ok) return;
        const { pages }: { pages: PageRow[] } = await pagesRes.json();
        const indexIds = new Set(
          pages.filter((p) => p.title === INDEX_TITLE && !p.isArchived).map((p) => p.id)
        );
        if (indexIds.size === 0) return;
        const kids = pages.filter(
          (p) => p.parentPageId && indexIds.has(p.parentPageId) && !p.isArchived
        );
        if (kids.length === 0) return;

 // 1:1 DM rooms by the other member's name — the card should open the
 // agent's living relationship doc when one exists, so map each person
 // to their room here and resolve the doc on click. Group rooms are
 // out of scope (a room-level doc has no single person to attach to).
        const roomByName = new Map<string, string>();
        try {
          const { rooms }: { rooms: DmRoomRow[] } = await (await fetch("/api/dm/rooms")).json();
          for (const room of rooms ?? []) {
            const humans = room.members.filter((m) => !m.isAgent);
            if (humans.length !== 2) continue;
            for (const m of humans) {
              const nk = nameKey(m.displayName ?? "");
              if (nk && !roomByName.has(nk)) roomByName.set(nk, room.id);
            }
          }
        } catch {
 // room lookup is best-effort — cards fall back to the record page
        }

 // levels by person name, from databases embedded on the index pages
 // (a "Level" select column). Discovered via the pages' own database
 // blocks — /api/databases scopes to the default workspace, which can
 // differ from the workspace these pages live in.
        const levels = new Map<string, number>();
        try {
          const dbIds = new Set<string>();
          for (const id of indexIds) {
            const { blocks } = await (await fetch(`/api/pages/${id}/blocks`)).json();
            for (const b of blocks ?? []) {
              if (b.type === "database" && b.content?.databaseId) dbIds.add(b.content.databaseId);
            }
          }
          for (const dbId of [...dbIds].slice(0, 4)) {
            const snap = await (await fetch(`/api/databases/${dbId}`)).json();
            const titleProp = snap.properties?.find((p: { type: string }) => p.type === "title");
            const levelProp = snap.properties?.find(
              (p: { name: string; type: string }) => p.type === "select" && p.name === "Level"
            );
            if (!titleProp || !levelProp) continue;
            for (const row of snap.rows) {
              const t = String(row.values[titleProp.id] ?? "");
              const opt = String(row.values[levelProp.id] ?? "");
              const m = opt.match(/(\d+)/); // option ids look like "lv5"
              if (t && m) levels.set(nameKey(t), Number(m[1]));
            }
          }
        } catch {
 // DB lookup is best-effort — faces render without badges
        }

        const list = kids.map((k) => {
          const name = partnerOf(k.title); // the other person, never "me"
          const key = name.toLowerCase();
          return {
            key,
            name,
            level: levels.get(key) ?? -1,
            pageId: k.id,
            roomId: roomByName.get(key) ?? null,
          };
        });
        list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
        if (alive) setPeople(list);
      } catch {
 // sidebar strip is decorative — fail silent
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** The relationship doc (agent-maintained, OKF) is the card's document;
 * the seeded record page is only the fallback for people without a room
 * or whose room has no doc yet (no consent / no messages processed). */
  async function openPerson(person: Person) {
    if (person.roomId) {
      try {
        const res = await fetch(`/api/dm/rooms/${person.roomId}`);
        if (res.ok) {
          const { room } = await res.json();
          if (room?.rootPageId) {
            router.push(`/p/${room.rootPageId}`);
            return;
          }
        }
      } catch {
 // fall through to the record page
      }
    }
    router.push(`/p/${person.pageId}`);
  }

  if (!people || people.length === 0) return null;

  return (
    <div data-testid="rel-strip" className="px-1 pb-2">
      <h3 className="px-1 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        Relationships
      </h3>
      <div
        className="flex w-full flex-nowrap gap-px overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {people.map((p) => (
          <button
            key={p.pageId}
            data-testid={`rel-face-${p.pageId}`}
            onClick={() => void openPerson(p)}
            className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800/70"
          >
            <Face person={p} />
            <span className="line-clamp-2 w-full text-center text-[10px] leading-[14px] text-neutral-500 dark:text-neutral-400">
              {p.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
