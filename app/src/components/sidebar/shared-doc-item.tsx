"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Page } from "@/lib/db/schema";
import { pageLabel, type PageRow } from "@/lib/page-label";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { PageIcon } from "@/components/page-icon";
import { useT } from "@/i18n/provider";
import { PageItem } from "./page-item";

/** Set by GET /api/pages, from okf_acl, on the root of a relation's memory doc:
 *  the doc is readable only by that relation's members. */
export interface RelationShare {
  roomId: string;
  roomName: string | null;
  people: number;
}

export function sharedWithOf(page: Page): RelationShare | null {
  return (page as Page & { sharedWith?: RelationShare }).sharedWith ?? null;
}

const EMPTY_CHILDREN: Page[] = [];

/**
 * A relation's memory doc in the sidebar's Shared section: the doc title, and
 * under it who it is shared with ("Tokyo Trip · 6 people") — listed under
 * Private it read as the viewer's own page. The root row is its own (no
 * rename / delete / drag: the doc belongs to the relation); the pages inside
 * are ordinary tree rows.
 */
export function SharedDocItem({ page, share }: { page: Page; share: RelationShare }) {
  const t = useT();
  const pathname = usePathname();
  const expanded = useUiStore((s) => s.expanded[page.id] ?? false);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const children = usePagesStore(useShallow((s) => s.childrenOf.get(page.id) ?? EMPTY_CHILDREN));
  const hasChildren = children.length > 0;
  const isActive = pathname === `/p/${page.id}`;
  const caption = [share.roomName, share.people > 1 ? t("{n} people", { n: share.people }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-testid={`shared-doc-${page.id}`}>
      <div
        className={`group flex items-start gap-0.5 rounded-md py-1 pl-1 pr-1 text-sm transition-colors max-md:py-2 ${
          isActive
            ? "bg-neutral-200/70 font-medium text-neutral-900 dark:bg-neutral-700/50 dark:text-neutral-100"
            : "text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800"
        }`}
      >
        <button
          data-testid={`page-tree-toggle-${page.id}`}
          onClick={hasChildren ? () => toggleExpanded(page.id) : undefined}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-neutral-300/60 max-md:h-7 max-md:w-7 dark:hover:bg-neutral-700"
          aria-label={hasChildren ? (expanded ? t("Collapse") : t("Expand")) : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
        >
          <span className={`text-[15px] leading-none ${hasChildren ? "group-hover:hidden" : ""}`}>
            <PageIcon icon={page.icon} fallback="📄" />
          </span>
          {hasChildren && (
            <ChevronRight
              size={12}
              className={`hidden transition-transform duration-150 group-hover:block ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </button>
        <Link
          href={`/p/${page.id}`}
          aria-current={isActive ? "page" : undefined}
          className="min-w-0 flex-1"
        >
          <span className="block truncate leading-5">{t(pageLabel(page as PageRow))}</span>
          {caption && (
            <span
              data-testid={`shared-doc-caption-${page.id}`}
              className="block truncate text-[11px] font-normal leading-4 text-neutral-400 dark:text-neutral-500"
            >
              {caption}
            </span>
          )}
        </Link>
      </div>
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <PageItem key={child.id} page={child} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}
