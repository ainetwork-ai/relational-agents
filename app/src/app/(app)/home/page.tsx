"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Star, FileText, LayoutGrid } from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { PageIcon } from "@/components/page-icon";
import { listRecentWorkspaces, recordWorkspaceVisit } from "@/lib/recent-workspaces";
import { initial } from "@/lib/glyph";

interface WorkspaceCard {
  id: string;
  name: string;
  iconText: string | null;
  iconUrl: string | null;
  description: string | null;
  lastEditedAt: string | null;
}

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return null;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

async function enterWorkspace(id: string) {
  recordWorkspaceVisit(id);
  await fetch("/api/workspaces/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: id }),
  }).catch(() => {});
  // full navigation: the sidebar tree, stores and server components all
  // re-read the newly pinned workspace
  window.location.href = "/";
}

function WsTile({ w }: { w: WorkspaceCard }) {
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl font-bold text-neutral-700 shadow-sm ring-1 ring-neutral-200 transition-transform group-hover:scale-105 dark:bg-neutral-700 dark:text-neutral-100 dark:ring-neutral-600">
      {initial(w.iconText || w.name)}
    </span>
  );
}

/** Workspace picker (workspacesManagement reference): every workspace the
 *  user belongs to is a card. "Recently visited" (this device's visit log)
 *  sits on top; the full grid is ordered by each workspace's last content
 *  edit. Clicking a card pins it as the session's active workspace. */
function WorkspaceSections() {
  const [list, setList] = useState<WorkspaceCard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(listRecentWorkspaces());
    let alive = true;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((d) => {
        if (!alive) return;
        setList(d.workspaces ?? []);
        setActiveId(d.activeId ?? null);
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);

  const byEdit = useMemo(
    () =>
      [...(list ?? [])].sort(
        (a, b) =>
          new Date(b.lastEditedAt ?? 0).getTime() - new Date(a.lastEditedAt ?? 0).getTime()
      ),
    [list]
  );
  // recents live IN the grid, not above it: visited-on-this-device first
  // (current workspace counts before any click), then by last edit — the
  // first row of cards IS "recently visited/edited", right under the title.
  const ordered = useMemo(() => {
    const visitIds = recentIds.length ? recentIds : activeId ? [activeId] : [];
    const rank = new Map(visitIds.map((id, i) => [id, i]));
    return [...byEdit].sort((a, b) => {
      const ra = rank.get(a.id) ?? Infinity;
      const rb = rank.get(b.id) ?? Infinity;
      return ra - rb; // equal (both unvisited) keeps byEdit order — sort is stable
    });
  }, [byEdit, recentIds, activeId]);
  const visitedSet = useMemo(
    () => new Set(recentIds.length ? recentIds : activeId ? [activeId] : []),
    [recentIds, activeId]
  );

  function enter(id: string) {
    setSwitching(id);
    void enterWorkspace(id);
  }

  if (!list || list.length === 0) return null;

  return (
    <>
      <section data-testid="home-workspaces" className="mb-10">
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          <LayoutGrid size={12} /> Your workspaces
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((w) => (
            <button
              key={w.id}
              data-testid={`home-ws-card-${w.id}`}
              onClick={() => enter(w.id)}
              disabled={switching !== null}
              className="group flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800/60"
            >
              <div className="flex h-36 items-center justify-center overflow-hidden border-b border-neutral-100 bg-neutral-50/80 dark:border-neutral-700/60 dark:bg-neutral-800">
                {w.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.iconUrl}
                    alt={w.name}
                    className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.03]"
                  />
                ) : (
                  <WsTile w={w} />
                )}
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                    {w.name}
                  </span>
                  {w.iconUrl && w.iconText && (
                    // photo replaces the emoji tile, so the emoji (e.g. the
                    // relationship heart) rides along beside the name instead
                    <span className="shrink-0 text-xs leading-none">{w.iconText}</span>
                  )}
                  {w.id === activeId && (
                    <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
                      current
                    </span>
                  )}
                  {w.id !== activeId && visitedSet.has(w.id) && (
                    <Clock size={11} aria-label="Recently visited" className="shrink-0 text-neutral-300 dark:text-neutral-500" />
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-neutral-400">
                  {switching === w.id
                    ? "Opening…"
                    : [w.description, ago(w.lastEditedAt) && `Edited ${ago(w.lastEditedAt)}`]
                        .filter(Boolean)
                        .join(" · ") || "Open this workspace"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Card({ p, testid }: { p: Page; testid: string }) {
  return (
    <Link
      data-testid={testid}
      href={`/p/${p.id}`}
      className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      <span className="shrink-0 text-base">
        <PageIcon icon={p.icon} fallback={<FileText size={16} className="text-neutral-400" />} />
      </span>
      <span className="truncate">{p.title || "Untitled"}</span>
    </Link>
  );
}

function Section({
  icon,
  title,
  items,
  prefix,
}: {
  icon: React.ReactNode;
  title: string;
  items: Page[];
  prefix: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {icon} {title}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((p) => (
          <Card key={p.id} p={p} testid={`${prefix}-${p.id}`} />
        ))}
      </div>
    </section>
  );
}

/** Home: greeting + workspace picker (visited / all, workspace-unit — pages
 *  only appear via Favorites, which are deliberate pins). */
export default function HomePage() {
  const pages = usePagesStore((s) => s.pages);
  const load = usePagesStore((s) => s.load);
  const [now] = useState(() => new Date());
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => alive && setMe(d?.user?.displayName ?? null));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => Object.values(pages).filter((p) => !p.isArchived), [pages]);
  const favorites = all.filter((p) => p.isFavorite).slice(0, 8);

  const hour = now.getHours();
  const greeting =
    hour < 6 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div data-testid="home-dashboard" className="mx-auto max-w-4xl px-8 pb-16 pt-[18vh]">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {greeting}
          {me ? `, ${me}!` : ""}
        </h1>
        <p className="mt-1 text-2xl font-bold text-neutral-300 dark:text-neutral-600">
          Ready to pick a workspace?
        </p>
      </div>
      <WorkspaceSections />
      <Section icon={<Star size={12} />} title="Favorites" items={favorites} prefix="home-fav" />
    </div>
  );
}
