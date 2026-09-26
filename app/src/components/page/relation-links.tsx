"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Landmark, MessageCircle } from "lucide-react";
import type { Page } from "@/lib/db/schema";
import { usePagesStore } from "@/stores/pages";
import { sharedWithOf, type RelationShare } from "@/components/sidebar/shared-doc-item";
import { useTreasuryV2 } from "@/components/treasury-app/use-treasury-ui";
import { useT } from "@/i18n/provider";

/** The path an OKF page id stands for (base64url of it), or null for a Postgres page. */
function okfPath(id: string): string | null {
  try {
    const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The relation whose memory doc holds this page: the doc's root itself, or a page inside its folder. */
function relationFor(pageId: string, roots: Page[]): RelationShare | null {
  const path = okfPath(pageId);
  for (const root of roots) {
    const share = sharedWithOf(root);
    if (!share) continue;
    if (root.id === pageId) return share;
    const rootPath = okfPath(root.id);
    if (path && rootPath && path.startsWith(`${rootPath}/`)) return share;
  }
  return null;
}

const PILL =
  "mr-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 max-md:h-8 max-md:px-2 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

/** On a relation's memory doc (and every page in it): the relation's chat and its treasury, one click away. */
export function RelationLinks({ pageId }: { pageId: string }) {
  const t = useT();
  const roots = usePagesStore((s) => s.roots);
  const treasuryV2 = useTreasuryV2();
  const share = useMemo(() => relationFor(pageId, roots), [pageId, roots]);
  if (!share) return null;
  const room = share.roomName ?? t("Chat");
  return (
    <>
      <Link href={`/dm/${share.roomId}`} data-testid="relation-doc-chat" title={room} className={PILL}>
        <MessageCircle size={12} aria-hidden />
        <span className="max-md:hidden">{room}</span>
      </Link>
      {treasuryV2 && (
        <Link href={`/treasury/${share.roomId}`} data-testid="relation-doc-treasury" title={t("Treasury")} className={PILL}>
          <Landmark size={12} aria-hidden />
          <span className="max-md:hidden">{t("Treasury")}</span>
        </Link>
      )}
    </>
  );
}
