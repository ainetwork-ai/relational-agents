"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { useTeamspacesStore } from "@/stores/teamspaces";
import type { Page } from "@/lib/db/schema";
import { pageLabel, type PageRow } from "@/lib/page-label";
import { PageIcon } from "@/components/page-icon";
import { useT } from "@/i18n/provider";

/** Page ancestry chain (Home › Parent › … › Current), shown in the page header.
 *  `current` is the SSR page record — the fallback start of the chain when the
 *  store hasn't picked the page up yet (a row's body page minted this session). */
export function Breadcrumbs({ pageId, current }: { pageId: string; current?: Page }) {
  const t = useT();
  const pages = usePagesStore((s) => s.pages);
  const teamspaces = useTeamspacesStore((s) => s.list);
  const loadTeamspaces = useTeamspacesStore((s) => s.load);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadTeamspaces();
  }, [loadTeamspaces]);

 // walk up parentPageId to the root, guarding against cycles
  const chain: { id: string; title: string; icon: string | null }[] = [];
  const seen = new Set<string>();
  let cur: Page | undefined = pages[pageId] ?? current;
  let rootPage: Page | undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift({ id: cur.id, title: t(pageLabel(cur as PageRow)), icon: cur.icon });
    rootPage = cur;
    cur = cur.parentPageId ? pages[cur.parentPageId] : undefined;
  }

 // A page inside a teamspace is named by that teamspace first — Notion shows
 // "<teamspace> / 🏠 Teamspace Home" rather than starting the trail at Home. The
 // teamspace comes from the topmost ancestor, since only top-level pages carry
 // the id; children inherit their place from it.
  const teamspace = rootPage?.teamspaceId
    ? teamspaces.find((ts) => ts.id === rootPage.teamspaceId)
    : undefined;

  return (
    <nav
      data-testid="breadcrumb"
      className="flex min-w-0 items-center gap-0.5 overflow-hidden text-sm text-neutral-500 dark:text-neutral-400"
    >
      {teamspace ? (
        <span
          data-testid="breadcrumb-teamspace"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-neutral-600 dark:text-neutral-300"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded bg-neutral-200 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
            {teamspace.icon || [...teamspace.name][0]}
          </span>
          <span className="max-w-[160px] truncate">{teamspace.name}</span>
        </span>
      ) : (
        <Link
          href="/"
          data-testid="breadcrumb-home"
          className="shrink-0 rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {t("Home")}
        </Link>
      )}
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
              aria-label={t("Show full path")}
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
