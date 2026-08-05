"use client";

import { useEffect, useRef, useState } from "react";
import type { Block, Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { PageView } from "./page-view";

/**
 * Notion's center peek: a page opened OVER whatever you were reading instead
 * of navigating to it. Creating a sub-page from the sidebar lands here — the
 * header names the destination ("추가 대상 🏠 팀스페이스 홈"), ⤢ promotes it to a
 * full page, and Esc / the backdrop / ✕ dismiss it.
 *
 * Geometry follows the reference capture (docs/page_add_popup.html): inset 72px
 * with a 975px cap, 12px corners, its own scroller so the page underneath
 * stays exactly where it was.
 */
export function PagePeek() {
  const peek = useUiStore((s) => s.peek);
  const closePeek = useUiStore((s) => s.closePeek);
  const pageId = peek?.pageId ?? null;
  const parentId = peek?.parentPageId ?? null;
 // the destination chip reads from the store the sidebar already loaded
  const parent = usePagesStore((s) => (parentId ? s.pages[parentId] ?? null : null));
  const [loaded, setLoaded] = useState<{ page: Page; blocks: Block[] } | null>(null);
 // derived, not reset in an effect: whatever was fetched for a PREVIOUS peek
 // must not flash inside the next one while its own fetch is in flight
  const data = loaded && loaded.page.id === pageId ? loaded : null;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    void Promise.all([
      fetch(`/api/pages/${pageId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/pages/${pageId}/blocks`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([p, b]) => {
      if (!alive) return;
 // page gone (deleted from another tab) → don't leave an empty popup up
      if (p?.page) setLoaded({ page: p.page, blocks: b?.blocks ?? [] });
      else closePeek();
    });
    return () => {
      alive = false;
    };
  }, [pageId, closePeek]);

  useEffect(() => {
    if (!pageId) return;
    const onKey = (e: KeyboardEvent) => {
 // The editor consumes Escape for its own layers (slash menu, block
 // selection) and preventDefaults it — one Escape must not both dismiss a
 // menu and throw the whole popup away.
      if (e.key === "Escape" && !e.defaultPrevented) closePeek();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pageId, closePeek]);

 // A just-created page opens ready to be named, as it does in Notion.
  useEffect(() => {
    if (!data) return;
    const el = panelRef.current?.querySelector('[data-testid="page-title"]');
    if (el instanceof HTMLTextAreaElement && !el.value) el.focus();
  }, [data]);

  if (!pageId) return null;

  return (
    <div data-testid="page-peek" className="fixed inset-0 z-50">
      <div
        data-testid="page-peek-backdrop"
        onClick={closePeek}
        className="absolute inset-0 bg-black/30"
      />
      <div
        ref={panelRef}
        data-testid="page-peek-panel"
        className="popover-anim absolute inset-x-3 bottom-6 top-6 mx-auto flex max-w-[975px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-[#191919] sm:inset-x-[72px] sm:bottom-[72px] sm:top-[72px]"
      >
        <div className="flex-1 overflow-y-auto">
          {data ? (
            <PageView
              key={data.page.id}
              initialPage={data.page}
              initialBlocks={data.blocks}
              peek={{ parent, onClose: closePeek }}
            />
          ) : (
            <div className="space-y-4 px-16 pt-20">
              <div className="h-10 w-1/2 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
