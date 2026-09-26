"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserAvatar } from "@/components/user-avatar";
import { RELATIONSHIP_DOC_PREFIXES } from "@/i18n/content/components";

interface Person {
  key: string;
  name: string;
  pageId: string | null; // their relationship doc; null = room-only (no doc yet)
  roomId: string | null; // 1:1 DM room with this person, when one exists
  partnerUserId?: string | null; // their user id — lets a click open/create the chat
  avatarUrl?: string | null; // their profile photo, from the room's member row
}

interface DmRoomRow {
  id: string;
  docPageId: string | null;
  members: { displayName: string; isAgent: boolean; avatarUrl: string | null }[];
}

interface PageRow {
  id: string;
  title: string;
  isArchived: boolean;
}

/** A title side → a comparable key: "· Grandma" / "Mom · Grandma" → "grandma" */
const nameKey = (t: string) =>
  t.replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();

// " · " is how rooms are named now; the hearts are how they were named before
const HEART_SPLIT = /(?:❤️|❤|♥|💛|🧡|🩷|💘|💝|❤‍🔥|❤️‍🔥|\s·\s)+/u;

/** Doc titles read "Family doc — <me> · <partner>" (rooms are named
 * "<me> · <partner>" — see lib/auth/display-name) and the face belongs to
 * whichever side isn't the viewer. Split on the heart rather than on every
 * symbol, because a name may carry hyphens of its own; the trailing "-<room6>"
 * an OKF doc folder ends in (lib/agent/okf-docs) is stripped separately.
 * Prefer the side that differs from `myName`, else the last one. */
const partnerOf = (title: string, myName?: string | null) => {
  const sides = title
    .split(HEART_SPLIT)
    .map((s) => s.replace(/^.*—/, "").replace(/-[0-9a-f]{6}\s*$/i, "").trim())
    .filter(Boolean);
  if (sides.length === 0) return title.trim();
  if (myName) {
    const other = sides.find((s) => nameKey(s) !== nameKey(myName));
    if (other && sides.some((s) => nameKey(s) === nameKey(myName))) return other;
  }
  return sides[sides.length - 1];
};

/** File-primary relationship docs are OKF root folders titled
 * "Family doc — <A> · <B>" (or its Korean form; older ones "Relationship doc — A ❤️ B").
 * The prefixes live in RELATIONSHIP_DOC_PREFIXES. */
const RELATIONSHIP_DOC_RE = new RegExp(`^(${RELATIONSHIP_DOC_PREFIXES.join("|")})\\s*—`, "i");
const isRelationshipDoc = (title: string) =>
  RELATIONSHIP_DOC_RE.test(title.trim());

/** Sidebar Chats tab, horizontal people strip: one round face per relation.
 * Faces come from file-primary OKF docs titled "Family doc — A · B"
 * (agent-maintained; okf_acl scopes them to participants) and from
 * agent-attached 1:1 rooms, which are relations before their first doc page
 * exists. Hidden when the viewer has neither. */
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
        const myName: string | null = await fetch("/api/auth/me")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.user?.displayName ?? null)
          .catch(() => null);
        // the workspace's member roster — a relation belongs in THIS
        // workspace only when the partner is one of its members
        const memberByKey = new Map<string, string>(
          await fetch("/api/workspace/members")
            .then((r) => (r.ok ? r.json() : { members: [] }))
            .then((d) =>
              (d.members ?? []).map((m: { id: string; displayName: string }) => [
                nameKey(m.displayName ?? ""),
                m.id,
              ])
            )
            .catch(() => [])
        );
        const memberNames = new Set(memberByKey.keys());

        // file-primary OKF docs — root pages titled "Family doc — A · B"
        // (the agent-maintained ones; okf_acl already scoped them to us)
        const okfDocs = pages.filter((p) => !p.isArchived && isRelationshipDoc(p.title));

 // 1:1 DM rooms by the other member's name — the card should open the
 // agent's living relationship doc when one exists, so map each person
 // to their room here and resolve the doc on click. Group rooms are
 // out of scope (a room-level doc has no single person to attach to).
        const roomByName = new Map<string, string>();
        // agent-attached 1:1 rooms ARE relations, doc or not — show a face
        // even before the agent writes the first doc page
        const roomRelations: {
          name: string;
          roomId: string;
          docPageId: string | null;
          avatarUrl: string | null;
        }[] = [];
        try {
          const { rooms }: { rooms: DmRoomRow[] } = await (await fetch("/api/dm/rooms")).json();
          for (const room of rooms ?? []) {
            const humans = room.members.filter((m) => !m.isAgent);
            if (humans.length !== 2) continue;
            for (const m of humans) {
              const nk = nameKey(m.displayName ?? "");
              if (nk && !roomByName.has(nk)) roomByName.set(nk, room.id);
            }
            const hasAgent = room.members.some((m) => m.isAgent);
            const partner = humans.find((m) => nameKey(m.displayName) !== nameKey(myName ?? ""));
            if (hasAgent && myName && partner) {
              roomRelations.push({
                name: partner.displayName,
                roomId: room.id,
                docPageId: room.docPageId ?? null,
                avatarUrl: partner.avatarUrl ?? null,
              });
            }
          }
        } catch {
 // room lookup is best-effort — a face falls back to its doc page
        }

        // one face per partner, whether we found them by doc or by room
        const byPartner = new Map<string, Person>();
        for (const d of okfDocs) {
          const name = partnerOf(d.title, myName);
          // OKF docs are workspace-agnostic files; only surface the ones whose
          // partner is a member of the current workspace
          if (memberNames.size > 0 && !memberNames.has(nameKey(name))) continue;
          const key = name.toLowerCase();
          byPartner.set(key, {
            key,
            name,
            pageId: d.id, // doc fallback when no chat can be opened
            roomId: roomByName.get(key) ?? null,
            partnerUserId: memberByKey.get(nameKey(name)) ?? null,
          });
        }
        if (okfDocs.length === 0 && roomRelations.length === 0) return;

        for (const r of roomRelations) {
          const key = r.name.toLowerCase();
          const prev = byPartner.get(key);
          byPartner.set(key, {
            key,
            name: r.name,
            // the room's own doc link is authoritative; a title-parsed page
            // only fills in for a partner we found by doc alone
            pageId: r.docPageId ?? prev?.pageId ?? null,
            roomId: r.roomId,
            partnerUserId: prev?.partnerUserId ?? null,
            avatarUrl: r.avatarUrl,
          });
        }
        const list = [...byPartner.values()];
        list.sort((a, b) => a.name.localeCompare(b.name));
        if (alive) setPeople(list);
      } catch {
 // sidebar strip is decorative — fail silent
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** A face opens the conversation; the agent-maintained OKF doc is the
 * fallback for a partner with no room, or whose room has no doc yet (no
 * consent / no messages processed). */
  async function openPerson(person: Person) {
    // a face opens the conversation — the room header links to the doc.
    if (person.roomId) {
      router.push(`/dm/${person.roomId}`);
      return;
    }
    // no room in this workspace yet: open (or create) the 1:1 with them —
    // they are a member here, so the same-workspace rule allows it
    if (person.partnerUserId) {
      try {
        const res = await fetch("/api/dm/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberIds: [person.partnerUserId] }),
        });
        if (res.ok) {
          const { room } = await res.json();
          if (room?.id) {
            router.push(`/dm/${room.id}`);
            return;
          }
        }
      } catch {
        // fall through to the doc
      }
    }
    if (person.pageId) router.push(`/p/${person.pageId}`);
  }

  if (!people || people.length === 0) return null;

  return (
    <div data-testid="rel-strip" className="px-1 pb-2">
      <div
        className="flex w-full flex-nowrap gap-px overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {people.map((p) => (
          <button
            key={p.pageId ?? p.roomId ?? p.key}
            data-testid={`rel-face-${p.pageId ?? p.roomId ?? p.key}`}
            onClick={() => void openPerson(p)}
            className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800/70"
          >
            <UserAvatar
              user={{ displayName: p.name, avatarUrl: p.avatarUrl }}
              size={44}
              className="shadow-sm ring-1 ring-black/5 dark:ring-white/10"
            />
            <span className="line-clamp-2 w-full text-center text-[10px] leading-[14px] text-neutral-500 dark:text-neutral-400">
              {p.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
