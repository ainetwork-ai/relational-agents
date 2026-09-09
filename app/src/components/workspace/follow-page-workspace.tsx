"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePagesStore } from "@/stores/pages";
import { recordWorkspaceVisit } from "@/lib/recent-workspaces";

/**
 * Opening a page makes its workspace the active one — Notion's rule, measured
 * 2026-09-09 (docs/qa-backlog.md QA-3): with the personal workspace active,
 * opening a ComCom page flipped the whole chrome to ComCom, no prompt.
 *
 * The page route renders this when the viewed page belongs to a workspace
 * other than the session's active one. The sidebar already shows the page's
 * workspace on the first paint (the layout derives it from the path), so this
 * only makes the SESSION follow — the cookie cannot be written during a server
 * render, and every workspace-scoped API (/api/pages, teamspaces, search)
 * reads it. Then a refresh re-runs the layout so everything agrees.
 */
export function FollowPageWorkspace({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (fired.current === workspaceId) return; // once per workspace, no loop on refresh
    fired.current = workspaceId;
    void (async () => {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) return;
      recordWorkspaceVisit(workspaceId);
      await usePagesStore.getState().load();
      router.refresh();
    })();
  }, [workspaceId, router]);
  return null;
}
