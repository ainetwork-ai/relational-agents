"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Star,
  StarOff,
  FileText,
  PanelLeftClose,
  PanelLeft,
  Search as SearchIcon,
  Home as HomeIcon,
  MessageCircle,
  SquarePen,
} from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { useAiChatsStore, unreadChatCount } from "@/stores/ai-chats";
import { totalDmUnread, useDmRoomsStore } from "@/stores/dm-rooms";
import { useDmEvents } from "@/hooks/use-dm-events";
import { ChatsPanel } from "./chats-panel";
import { PageItem } from "./page-item";
import { SharedDocItem, sharedWithOf } from "./shared-doc-item";
import { TrashModal } from "./trash-modal";
import { WorkspaceSwitcher, type ActiveWorkspace } from "./workspace-switcher";
import { AindriveSection } from "./aindrive-section";
import { TeamspacesSection } from "./teamspaces-section";
import { SectionMenu, sortRows } from "./section-menu";
import { ImportButton } from "@/components/import/import-button";
import { NotificationsInbox, InboxPanel } from "@/components/notifications/inbox";
import { PageIcon } from "@/components/page-icon";
import { pageLabel, pageFallbackIcon, type PageRow } from "@/lib/page-label";
import { useSectionCollapse } from "@/hooks/use-section-collapse";
import { chipColors } from "@/components/database/option-chip";
import { useTreasurySummary } from "./use-treasury-summary";
import { initial } from "@/lib/glyph";
import { useT } from "@/i18n/provider";

export function Sidebar({
  workspace,
  workspaceName,
  displayName,
}: {
  workspace?: ActiveWorkspace | null;
  workspaceName: string;
  displayName: string;
}) {
  const router = useRouter();
  const t = useT();
  const loaded = usePagesStore((s) => s.loaded);
  const load = usePagesStore((s) => s.load);
  const createPage = usePagesStore((s) => s.createPage);
  const updatePage = usePagesStore((s) => s.updatePage);
  const setTrashOpen = useUiStore((s) => s.setTrashOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const activeTab = useAiChatsStore((s) => s.activeTab);
  const setTab = useAiChatsStore((s) => s.setTab);
 // Inbox swaps the sidebar content in place, not a popup.
  const [showInbox, setShowInbox] = useState(false);
  const aiChatsList = useAiChatsStore((s) => s.chats);
  const loadAiChats = useAiChatsStore((s) => s.load);
  const aiChatsUnread = unreadChatCount(aiChatsList);
 // the Chats tab's unread badge must show before the tab opens — load on sidebar mount.
  useEffect(() => {
    loadAiChats();
  }, [loadAiChats]);

 // DM realtime bridge — the sidebar is always mounted, so subscribe to the
 // inbox here and keep room list / unread badges fresh regardless of tab
 // state (the stream is pool-shared).
  const dmRooms = useDmRoomsStore((s) => s.rooms);
  const loadDmRooms = useDmRoomsStore((s) => s.load);
  const dmUnread = totalDmUnread(dmRooms);
  const dmReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useDmEvents(
    (event) => {
      if (event.type === "dm-typing") return;
 // coalesce event bursts into a single refetch
      if (dmReloadTimer.current) clearTimeout(dmReloadTimer.current);
      dmReloadTimer.current = setTimeout(() => void loadDmRooms(), 250);
    },
 // hello = initial connect/reconnect — refetch recovers changes missed while down
    () => void loadDmRooms()
  );
 // cancel the scheduled refetch on unmount (logout etc.) — no fetches from dead components
  useEffect(() => {
    return () => {
      if (dmReloadTimer.current) clearTimeout(dmReloadTimer.current);
    };
  }, []);
 // collapsed-state hover peek: slide the sidebar in as a temporary
 // overlay when the pointer rests on the left edge
  const [peek, setPeek] = useState(false);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

 // where you are decides what the sidebar shows: a room is found on the Chats
 // tab (Home already puts it back on Pages), and on a phone the drawer gets out
 // of the way of the page a row just opened
  const pathname = usePathname();
 // money across relations lives on Home: its icon carries a dot while a vote of mine is owed anywhere
  const treasuries = useTreasurySummary();
  const voteOwed = useMemo(() => [...treasuries.values()].some((r) => r.pendingForMe > 0), [treasuries]);
  useEffect(() => {
    setMobileNavOpen(false);
    if (pathname.startsWith("/dm/")) setTab("chats");
  }, [pathname, setMobileNavOpen, setTab]);

 // ask for THIS sidebar's workspace (the viewed page's — the layout chose it),
 // not the session's: otherwise a page opened from another workspace showed
 // the old tree until the session followed (QA-3). Re-runs when it changes.
  const workspaceId = workspace?.id;
  useEffect(() => {
    load(workspaceId);
  }, [load, workspaceId]);

  const roots = usePagesStore((s) => s.roots);
 // A relation's memory doc is readable only by the relation's members, so it is
 // Shared, not Private — listed under Private it read as the viewer's own page.
 // The server marks the doc root (sharedWith, from okf_acl); Private keeps the rest.
  const sharedDocs = useMemo(
    () => roots.flatMap((p) => {
      const share = sharedWithOf(p);
      return share ? [{ page: p, share }] : [];
    }),
    [roots]
  );
  const privateRoots = useMemo(() => roots.filter((p) => !sharedWithOf(p)), [roots]);
  const sidebarSort = useUiStore((s) => s.sidebarSort);
  const [sharedCollapsed, toggleShared] = useSectionCollapse("shared");
  const [favsCollapsed, toggleFavs] = useSectionCollapse("favorites");
 // draggable width, remembered — 270 is the original's (e2e/sidebar-width.check.mjs)
  const [sbWidth, setSbWidth] = useState(270);
  useEffect(() => {
 // deferred so no setState runs synchronously in the effect body
    void Promise.resolve().then(() => {
      const w = Number(localStorage.getItem("sidebar-width"));
      if (w >= 200 && w <= 480) setSbWidth(w);
    });
  }, []);
 // tab labels need ~55px beyond the six 32px pills — below that the selected
 // tab stays icon-only so the row never overflows the resizable width
  const showTabLabels = sbWidth >= 270;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const w = Math.min(480, Math.max(200, ev.clientX));
      setSbWidth(w);
      try { localStorage.setItem("sidebar-width", String(w)); } catch {}
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const [shared, setShared] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/pages/shared")
      .then((r) => (r.ok ? r.json() : { pages: [] }))
      .then((d) => alive && setShared(d.pages ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [roots]);

  const favorites = usePagesStore((s) => s.favorites);

  async function newPage() {
    const page = await createPage(null);
    router.push(`/p/${page.id}`);
  }

  if (collapsed) {
    return (
      <>
        <div
          data-testid="sidebar-peek-zone"
          onMouseEnter={() => setPeek(true)}
          className="fixed inset-y-0 left-0 z-30 w-1.5"
          aria-hidden="true"
        />
        <button
          data-testid="sidebar-expand"
          onClick={() => {
            setPeek(false);
            setCollapsed(false);
          }}
          onMouseEnter={() => setPeek(true)}
          className="fixed left-2 top-2 z-40 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          aria-label={t("Open sidebar")}
        >
          <PanelLeft size={18} />
        </button>
        {peek && (
          <div
            data-testid="sidebar-peek"
            onMouseLeave={() => setPeek(false)}
            className="popover-anim fixed bottom-14 left-1.5 top-12 z-40 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2 shadow-2xl dark:border-neutral-700 dark:bg-[#202020]"
          >
            {favorites.length > 0 && (
              <div className="mb-2">
                <p className="px-2 py-1 text-xs font-medium text-neutral-400">{t("Favorites")}</p>
                {favorites.map((p) => (
                  <a
                    key={p.id}
                    href={`/p/${p.id}`}
                    className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    <span className="shrink-0 text-[15px] leading-none"><PageIcon icon={p.icon} fallback={pageFallbackIcon(p as PageRow)} /></span>
                    <span className="truncate">{t(pageLabel(p as PageRow))}</span>
                  </a>
                ))}
              </div>
            )}
            {sharedDocs.length > 0 && (
              <div className="mb-2">
                <p className="px-2 py-1 text-xs font-medium text-neutral-400">{t("Shared")}</p>
                {sharedDocs.map(({ page, share }) => (
                  <SharedDocItem key={page.id} page={page} share={share} />
                ))}
              </div>
            )}
            <p className="px-2 py-1 text-xs font-medium text-neutral-400">{t("Private")}</p>
            {privateRoots.map((p) => (
              <PageItem key={p.id} page={p} depth={0} />
            ))}
          </div>
        )}
        <TrashModal />
      </>
    );
  }

  return (
    <>
      {/* mobile drawer backdrop (tap to dismiss) */}
      {mobileNavOpen && (
        <div
          data-testid="mobile-nav-backdrop"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:hidden"
        />
      )}
      <aside
        data-testid="sidebar"
        style={{ width: sbWidth }}
        className={`group/sidebar relative flex h-full shrink-0 flex-col border-r border-neutral-200/80 bg-neutral-50 dark:border-white/10 dark:bg-[#202020] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-64 max-md:shadow-xl max-md:transition-transform max-md:duration-200 ${
          mobileNavOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        }`}
      >
        <button
          data-testid="mobile-nav-close"
          onClick={() => setMobileNavOpen(false)}
          aria-label={t("Close menu")}
          className="absolute right-2 top-2 z-10 rounded-md p-1 text-neutral-400 hover:bg-neutral-200/60 md:hidden"
        >
          <PanelLeftClose size={16} />
        </button>
      {/* Row 1 — workspace line only ( layout: tools live on the row
          below; this line carries just the switcher and the collapse control) */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        {workspace ? (
          <WorkspaceSwitcher workspace={workspace} displayName={displayName} />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-neutral-300 text-[10px] font-bold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
              {initial(workspaceName)}
            </div>
            <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {workspaceName}
            </span>
          </div>
        )}
        <button
          data-testid="sidebar-collapse"
          onClick={() => setCollapsed(true)}
          className="ml-auto rounded p-1 text-neutral-400 opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 group-hover/sidebar:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
          aria-label={t("Close sidebar")}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Row 2 — tool line: Home · Pages · Chats · Inbox pills, search/compose
          at the end (new-tab row). Icons keep their 32px footprint; the
          selected tab's label only renders when the sidebar is wide enough, so
          narrow widths degrade to a clean row of evenly-sized icon pills. */}
      <div className="mb-1 flex items-center justify-between gap-0.5 px-1.5 pb-1">
        <div
          role="tablist"
          aria-label={t("Sidebar sections")}
          className="flex min-w-0 items-center gap-0.5"
        >
          <a
            data-testid="sidebar-home"
            href="/home"
            // Home is where pages start from, so leaving a chat for it puts the
            // sidebar back on the page tree — a remembered Chats tab would keep
            // showing the DM list over a Home that has nothing to do with it.
            onClick={() => {
              setShowInbox(false);
              setTab("pages");
            }}
            aria-label={voteOwed ? t("Home · your approval is waiting") : t("Home")}
            data-tip={voteOwed ? t("Home · your approval is waiting") : t("Home")}
            className="flex h-8 w-8 min-w-7 shrink items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <span className="relative flex">
              <HomeIcon size={16} />
              {voteOwed && (
                <i
                  data-testid="sidebar-home-owed"
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-neutral-50 dark:ring-[#202020]"
                  style={{ background: chipColors("orange").dot }}
                />
              )}
            </span>
          </a>
          <button
            role="tab"
            data-testid="sidebar-tab-pages"
            aria-selected={activeTab === "pages"}
            aria-label={t("Page")}
            onClick={() => {
              setShowInbox(false);
              setTab("pages");
            }}
            className={`flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
              activeTab === "pages"
                ? `bg-neutral-200/70 text-neutral-800 dark:bg-neutral-700/70 dark:text-neutral-100 ${showTabLabels ? "px-2.5" : "w-8 min-w-7 shrink"}`
                : "w-8 min-w-7 shrink text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            <FileText size={16} className="shrink-0" />
            {activeTab === "pages" && showTabLabels && t("Page")}
          </button>
          <button
            role="tab"
            data-testid="sidebar-tab-chats"
            aria-selected={activeTab === "chats"}
            aria-label={t("Chats")}
            onClick={() => {
              setShowInbox(false);
              setTab("chats");
            }}
            className={`relative flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors ${
              activeTab === "chats"
                ? `bg-neutral-200/70 text-neutral-800 dark:bg-neutral-700/70 dark:text-neutral-100 ${showTabLabels ? "px-2.5" : "w-8 min-w-7 shrink"}`
                : "w-8 min-w-7 shrink text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            <MessageCircle size={16} className="shrink-0" />
            {activeTab === "chats" && showTabLabels && t("Chats")}
            {dmUnread > 0 && (
              <span
                data-testid="sidebar-chats-unread"
                aria-label={t("{n} unread messages", { n: dmUnread })}
                className={`flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-500 px-[3px] text-[9px] font-semibold text-white ${
                  activeTab === "chats" && showTabLabels ? "" : "absolute -top-0.5 -right-0.5"
                }`}
              >
                {dmUnread > 99 ? "99+" : dmUnread}
              </span>
            )}
            {aiChatsUnread > 0 && (
              <span
                data-testid="chats-tab-unread-badge"
                aria-label={t("{n} unread chats", { n: aiChatsUnread })}
                className={`flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-500 px-[3px] text-[9px] font-semibold text-white ${
                  activeTab === "chats" && showTabLabels ? "" : "absolute -bottom-0.5 -right-0.5"
                }`}
              >
                {aiChatsUnread > 99 ? "99+" : aiChatsUnread}
              </span>
            )}
          </button>
          <NotificationsInbox
            active={showInbox}
            showLabel={showTabLabels}
            onOpen={() => setShowInbox((v) => !v)}
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            data-testid="sidebar-search"
            onClick={() => setSearchOpen(true)}
            aria-label={t("Search")}
            data-tip={t("Search (Ctrl+K)")}
            className="flex h-8 w-8 min-w-7 shrink items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <SearchIcon size={16} />
          </button>
          <button
            data-testid="sidebar-compose"
            onClick={() => void newPage()}
            aria-label={t("New page")}
            data-tip={t("New page")}
            className="flex h-8 w-8 min-w-7 shrink items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <SquarePen size={16} />
          </button>
        </div>
      </div>

      {showInbox ? (
        <InboxPanel onClose={() => setShowInbox(false)} />
      ) : activeTab === "chats" ? (
        <ChatsPanel />
      ) : (
      <nav aria-label={t("Page")} className="flex-1 overflow-y-auto px-2 pb-4">
        <TeamspacesSection workspaceId={workspace?.id ?? null} />
        <AindriveSection />
        {(sharedDocs.length > 0 || shared.length > 0) && (
          <section className="mb-4" data-testid="shared-section">
            <button
              data-testid="sidebar-section-toggle-shared"
              onClick={toggleShared}
              className="block px-2 pb-1 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              {t("Shared")}
            </button>
            {!sharedCollapsed && sharedDocs.map(({ page, share }) => (
              <SharedDocItem key={page.id} page={page} share={share} />
            ))}
            {!sharedCollapsed && shared.map((p) => (
              <a
                key={p.id}
                data-testid={`shared-item-${p.id}`}
                href={`/p/${p.id}`}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <span className="shrink-0 text-[15px] leading-none"><PageIcon icon={p.icon} fallback={pageFallbackIcon(p as PageRow)} /></span>
                <span className="truncate">{t(pageLabel(p as PageRow))}</span>
              </a>
            ))}
          </section>
        )}
        {favorites.length > 0 && (
          <section className="mb-4" data-testid="favorites-section">
            <button
              data-testid="sidebar-section-toggle-favorites"
              onClick={toggleFavs}
              className="block px-2 py-1 text-left text-xs font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              {t("Favorites")}
            </button>
            {!favsCollapsed && favorites.map((p) => (
              <div
                key={p.id}
                className="group/fav flex items-center rounded-md pr-1 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800"
              >
                <a
                  data-testid={`favorite-item-${p.id}`}
                  href={`/p/${p.id}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400"
                >
                  <Star size={13} className="shrink-0 text-neutral-400" />
                  <span className="shrink-0 text-[15px] leading-none"><PageIcon icon={p.icon} fallback={pageFallbackIcon(p as PageRow)} /></span>
                  <span className="truncate">{t(pageLabel(p as PageRow))}</span>
                </a>
                <button
                  data-testid={`favorite-remove-${p.id}`}
                  onClick={() => updatePage(p.id, { isFavorite: false })}
                  className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-300/60 hover:text-neutral-600 group-hover/fav:flex dark:hover:bg-neutral-700"
                  aria-label={t("Remove from Favorites")}
                >
                  <StarOff size={12} />
                </button>
              </div>
            ))}
          </section>
        )}
        <section>
          {/* The + reveals on hover, as Notion's section headers do: a sidebar
              full of always-visible buttons reads as clutter, and the row is
              the affordance. focus-visible keeps it reachable by keyboard. */}
          <div className="group/section flex items-center justify-between px-2 py-1">
            <h3
              className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400"
              data-testid="private-section-label"
            >
              {t("Private")}
            </h3>
            <div className="flex items-center gap-0.5">
              <SectionMenu testId="private-section-menu" label={t("Private")} />
              <button
                data-testid="sidebar-new-page"
                onClick={newPage}
                className="rounded p-0.5 text-neutral-400 max-md:p-2 touch-reveal opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/section:opacity-100 dark:hover:bg-neutral-700"
                aria-label={t("Add a page")}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {!loaded ? (
            <div className="space-y-1.5 px-2 py-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-5 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800"
                />
              ))}
            </div>
          ) : privateRoots.length === 0 ? (
            <p className="px-2 py-1 text-xs text-neutral-400">{t("No pages")}</p>
          ) : (
            sortRows(privateRoots, sidebarSort).map((p) => <PageItem key={p.id} page={p} depth={0} />)
          )}
        </section>
      </nav>
      )}

      <div className="border-t border-neutral-200/80 px-2 py-2 dark:border-neutral-800">
        <button
          data-testid="trash-button"
          onClick={() => setTrashOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <Trash2 size={15} />
          {t("Trash")}
        </button>
        <button
          data-testid="add-page-button"
          onClick={newPage}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <FileText size={15} />
          {t("New page")}
        </button>
        <ImportButton />

      </div>

      <TrashModal />
        <div
          data-testid="sidebar-resize"
          onPointerDown={startResize}
          className="absolute inset-y-0 right-0 w-1 cursor-col-resize hover:bg-blue-300/50"
          aria-hidden="true"
        />
      </aside>
    </>
  );
}
