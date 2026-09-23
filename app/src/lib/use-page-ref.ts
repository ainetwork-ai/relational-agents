"use client";

import { useEffect, useState } from "react";

export interface PageRef {
  id: string;
  title: string;
  icon: string | null;
}

// Shared across every cell on screen: a table can link the same page from a
// dozen rows, and one fetch per cell would be a dozen requests for one title.
// A null entry is a real answer (gone, or not ours to read) and is cached too,
// so a broken link is not retried on every render.
const cache = new Map<string, PageRef | null>();
const inflight = new Map<string, Promise<PageRef | null>>();

async function load(pageId: string): Promise<PageRef | null> {
  const res = await fetch(`/api/pages/${pageId}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const page = data?.page;
  if (!page) return null;
  return { id: pageId, title: page.title ?? "", icon: page.icon ?? null };
}

/** Title + icon for an in-app page link. `null` pageId is allowed so callers
 *  can keep hook order stable when the value is not a page.
 *
 *  The cache IS the state: what to render is derived during render, and the
 *  effect only does the fetch and nudges a re-render when it lands. Mirroring
 *  the cache into useState would mean two sources of truth for one title. */
export function usePageRef(pageId: string | null): { ref: PageRef | null; loading: boolean } {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!pageId || cache.has(pageId)) return;
    let alive = true;
    let pending = inflight.get(pageId);
    if (!pending) {
      pending = load(pageId)
        .catch(() => null)
        .then((r) => {
          cache.set(pageId, r);
          inflight.delete(pageId);
          return r;
        });
      inflight.set(pageId, pending);
    }
    void pending.then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [pageId]);

  const known = pageId !== null && cache.has(pageId);
  return {
    ref: known ? cache.get(pageId as string) ?? null : null,
    loading: pageId !== null && !known,
  };
}
