"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, ChevronRight } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { PageItem } from "./page-item";
import { useSectionCollapse } from "@/hooks/use-section-collapse";
import { SectionMenu, sortRows } from "./section-menu";
import { TeamspaceCreateModal } from "./teamspace-create-modal";
import { useTeamspacesStore } from "@/stores/teamspaces";
import { useT } from "@/i18n/provider";

/** Sidebar "Teamspaces" section: create a teamspace, list them, expand each to
 * its pages. A page created here belongs to the teamspace (pages.teamspaceId). */
export function TeamspacesSection({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();
  const t = useT();
  const teamspaces = useTeamspacesStore((s) => s.list);
  const reloadTeamspaces = useTeamspacesStore((s) => s.reload);
  const [creating, setCreating] = useState(false);
  const byTeamspace = usePagesStore((s) => s.byTeamspace);
  const createPage = usePagesStore((s) => s.createPage);
  const loadPages = usePagesStore((s) => s.load);
  const expanded = useUiStore((s) => s.expanded);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const expand = useUiStore((s) => s.expand);
  const [sectionCollapsed, toggleCollapsed] = useSectionCollapse("teamspaces");
  const sidebarSort = useUiStore((s) => s.sidebarSort);

 // Re-fetch when the active workspace changes (switch → server refresh → new prop).
  useEffect(() => {
    void reloadTeamspaces(workspaceId ?? undefined);
  }, [workspaceId, reloadTeamspaces]);

  // Creation now lives in TeamspaceCreateModal, which follows Notion's two
  // steps (details, then invite) instead of a bare name field in the sidebar.
  /**
   * A new teamspace arrives with its 팀스페이스 홈 page, so both lists have to be
   * refetched — reloading only the teamspaces left the row expanding to "No
   * pages inside" while the page sat in the database.
   */
  async function afterCreate() {
    await Promise.all([reloadTeamspaces(), loadPages()]);
  }

  async function addPage(teamspaceId: string) {
    const page = await createPage(null, teamspaceId);
    expand(`ts-${teamspaceId}`);
    router.push(`/p/${page.id}`);
  }

  return (
    <section className="mb-4" data-testid="teamspaces-section">
      {/* Same hover rule as the Private header — the + is an action on the
          section you are pointing at, not permanent furniture. */}
      <div className="group/section flex items-center justify-between px-2 py-1">
        <button
          data-testid="sidebar-section-toggle-teamspaces"
          onClick={toggleCollapsed}
          className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          {t("팀스페이스")}
        </button>
        <div className="flex items-center gap-0.5">
          <SectionMenu testId="teamspaces-section-menu" label={t("팀스페이스")} />
          <button
            data-testid="teamspace-create"
            onClick={() => setCreating((v) => !v)}
            className="rounded p-0.5 text-neutral-400 opacity-0 transition-all hover:bg-neutral-200/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/section:opacity-100 dark:hover:bg-neutral-700"
            aria-label={t("새 팀스페이스")}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {creating && (
        <TeamspaceCreateModal onClose={() => setCreating(false)} onCreated={() => void afterCreate()} />
      )}

      {teamspaces.length === 0 && !creating && (
        <p className="px-2 py-1 text-xs text-neutral-400">{t("팀스페이스가 없습니다")}</p>
      )}

      {!sectionCollapsed &&
        (sidebarSort === "alpha"
          ? [...teamspaces].sort((a, b) => a.name.localeCompare(b.name, "ko"))
          : teamspaces
        ).map((ts) => {
        const key = `ts-${ts.id}`;
        const isOpen = expanded[key] ?? false;
        const tsPages = byTeamspace.get(ts.id) ?? [];
        return (
          <div key={ts.id}>
            <div className="group/row flex items-center rounded-md pr-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800">
              <button
                data-testid={`teamspace-${ts.id}`}
                onClick={() => toggleExpanded(key)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1"
              >
                <ChevronRight
                  size={14}
                  className={`shrink-0 text-neutral-400 transition-transform duration-150 ${
                    isOpen ? "rotate-90" : ""
                  }`}
                />
                <Users size={13} className="shrink-0 text-neutral-400" />
                <span className="truncate">{ts.name}</span>
              </button>
              <button
                data-testid={`teamspace-add-page-${ts.id}`}
                onClick={() => void addPage(ts.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-all hover:bg-neutral-300/60 hover:text-neutral-600 focus-visible:opacity-100 group-hover/row:opacity-100 dark:hover:bg-neutral-700"
                aria-label={t("페이지 추가")}
              >
                <Plus size={14} />
              </button>
            </div>
            {isOpen && (
              <>
                {sortRows(tsPages, sidebarSort).map((p) => (
                  <PageItem key={p.id} page={p} depth={1} />
                ))}
                {/* Notion closes a teamspace's list with a 새로 추가 row rather
                    than an empty-state sentence: the way to add a page should sit
                    where the pages are, not only behind a hover target. */}
                <button
                  data-testid={`teamspace-add-row-${ts.id}`}
                  onClick={() => void addPage(ts.id)}
                  className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-200/50 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  style={{ paddingLeft: "36px" }}
                >
                  <Plus size={14} className="shrink-0" />
                  {t("새로 추가")}
                </button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
