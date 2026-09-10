"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { MentionPerson } from "@/lib/mention/search";

/**
 * The workspace's membership, shared by everything that needs to know who is
 * a real member: the @ menu, every comment composer, and CommentBody (which
 * may only tint a name that actually belongs to someone).
 *
 * `null` means "not known yet" and is NOT the same as `[]`: CommentBody draws
 * plain text while the answer is null rather than guessing at a mention, and a
 * share link (no session → 401) settles on `[]`, which is also "tint nothing".
 *
 * WHY THE MENU REVALIDATES (`useWorkspaceMembers(true)`)
 * `/api/workspace/members` answers for the SESSION's active workspace, and
 * opening a page in another workspace pins that only after hydration
 * (components/workspace/follow-page-workspace.tsx POSTs /api/workspaces/switch).
 * A fetch that lands before that POST answers for the wrong workspace — on
 * this dev account, the personal workspace with one member in it. So a
 * long-lived cache alone would keep a page stuck with the wrong list; the menu
 * asks again each time it opens, which is what the old MentionMenu did anyway,
 * and everyone else is corrected by the answer it stores. That ask carries the
 * `pageId` a comment surface declared (see `pageScope`), so it is answered for
 * the page's workspace and not for whatever the session happens to have
 * active.
 */
let cache: MentionPerson[] | null = null;
/** which page the cached answer was fetched for (`null` = the session's own
 *  workspace). A cache for another page is not an answer for this one. */
let cachedFor: string | null = null;
let flight: Promise<MentionPerson[]> | null = null;
let flightFor: string | null = null;
/**
 * WHICH PAGE THE SURFACES ON SCREEN BELONG TO
 * `/api/workspace/members?pageId=` answers for the workspace of THAT page
 * rather than the session's active one — which is the only correct answer for
 * a comment on a page in another workspace. The comment surfaces know the id
 * (they were given it to post with) and declare it here; the @ menu, which is
 * handed a caret and a query and nothing else, then reuses it. Kept at module
 * scope for the same reason the cache is: every composer and menu on screen
 * must be asking about the same page.
 */
let pageScope: string | null = null;
/** the ask that is allowed to write the cache — a slower earlier fetch for
 *  another page must not land on top of a newer one */
let seq = 0;
const subscribers = new Set<() => void>();

function endpoint(pageId: string | null): string {
  return pageId
    ? `/api/workspace/members?pageId=${encodeURIComponent(pageId)}`
    : "/api/workspace/members";
}

async function fetchMembers(pageId: string | null): Promise<MentionPerson[]> {
  const mine = ++seq;
  const members = await fetch(endpoint(pageId))
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((d: { members?: MentionPerson[] }) => d.members ?? [])
    .catch(() => [] as MentionPerson[]);
  if (mine !== seq) return members; // a newer ask is in charge
  cache = members;
  cachedFor = pageId;
  flight = null;
  flightFor = null;
  for (const notify of subscribers) notify();
  return members;
}

/** Remember the page a caller named, and say which page to ask about. */
function scopeFor(pageId?: string | null): string | null {
  if (pageId) pageScope = pageId;
  return pageId ?? pageScope;
}

/** Fetch once and share the answer. */
export function loadWorkspaceMembers(pageId?: string | null): Promise<MentionPerson[]> {
  const want = scopeFor(pageId);
  if (cache && cachedFor === want) return Promise.resolve(cache);
  if (flight && flightFor === want) return flight;
  flightFor = want;
  flight = fetchMembers(want);
  return flight;
}

/** Ask again — the active workspace may have changed under the cache. */
export function refreshWorkspaceMembers(pageId?: string | null): Promise<MentionPerson[]> {
  const want = scopeFor(pageId);
  if (flight && flightFor === want) return flight;
  flightFor = want;
  flight = fetchMembers(want);
  return flight;
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

/**
 * The membership, or null until the fetch answers.
 * `revalidate` re-asks on mount instead of trusting the cache — for the
 * surfaces where a stale list is a wrong answer (the @ menu).
 * `pageId` says which page the surface is on; pass it wherever it is known
 * (the comment surfaces), and every later ask — the @ menu's included — is
 * about that page's workspace.
 */
export function useWorkspaceMembers(
  revalidate = false,
  pageId?: string | null
): MentionPerson[] | null {
 // an external store rather than state + effect: the cache lives outside
 // React, and every mounted composer must see the same array
  const members = useSyncExternalStore(
    subscribe,
    () => cache,
    () => null
  );

  useEffect(() => {
    void (revalidate ? refreshWorkspaceMembers(pageId) : loadWorkspaceMembers(pageId));
  }, [revalidate, pageId]);

  return members;
}
