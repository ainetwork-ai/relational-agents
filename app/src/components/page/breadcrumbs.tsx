"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import type { Page } from "@/lib/db/schema";
import { PageIcon } from "@/components/page-icon";

/** Page ancestry chain (Home › Parent › … › Current), shown in the page header. */
export function Breadcrumbs({ pageId }: { pageId: string }) {
  const pages = usePagesStore((s) => s.pages);
  const [expanded, setExpanded] = useState(false);

 // walk up parentPageId to the root, guarding against cycles
  const chain: { id: string; title: string; icon: string | null }[] = [];
  const seen = new Set<string>();
  let cur: Page | undefined = pages[pageId];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift({ id: cur.id, title: cur.title || "Untitled", icon: cur.icon });
    cur = cur.parentPageId ? pages[cur.parentPageId] : undefined;
  }

  return (
    <nav
      data-testid="breadcrumb"
      className="flex min-w-0 items-center gap-0.5 overflow-hidden text-sm text-neutral-500 dark:text-neutral-400"
    >
      <Link
        href="/"
        data-testid="breadcrumb-home"
        className="shrink-0 rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        Home
      </Link>
      {(expanded || chain.length <= 3
        ? chain
        : [chain[0], { id: "__ellipsis__", title: "…", icon: null }, chain[chain.length - 1]]
      ).map((c) =>
        c.id === "__ellipsis__" ? (
          <span key="ellipsis" className="flex items-center gap-0.5">
            <ChevronRight size={13} className="shrink-0 text-neutral-300 dark:text-neutral-600" />
            <button
              data-testid="breadcrumb-ellipsis"
              onClick={() => setExpanded(true)}
              className="rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Show full path"
            >
              …
            </button>
          </span>
        ) : (
        <span key={c.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight size={13} className="shrink-0 text-neutral-300 dark:text-neutral-600" />
          <Link
            href={`/p/${c.id}`}
            data-testid="breadcrumb-crumb"
            className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {c.icon && <span className="shrink-0 text-[13px] leading-none"><PageIcon icon={c.icon} /></span>}
            <span className="truncate">{c.title}</span>
          </Link>
        </span>
        )
      )}
    </nav>
  );
}
