"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, ChevronRight } from "lucide-react";
import { usePagesStore } from "@/stores/pages";
import { useUiStore } from "@/stores/ui";
import { PageItem } from "./page-item";
import { useSectionCollapse } from "@/hooks/use-section-collapse";

interface Teamspace {
  id: string;
  name: string;
}

/** Sidebar "Teamspaces" section: create a teamspace, list them, expand each to
 *  its pages. A page created here belongs to the teamspace (pages.teamspaceId). */
export function TeamspacesSection({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();
  const [teamspaces, setTeamspaces] = useState<Teamspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const byTeamspace = usePagesStore((s) => s.byTeamspace);
  const createPage = usePagesStore((s) => s.createPage);
  const expanded = useUiStore((s) => s.expanded);
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const expand = useUiStore((s) => s.expand);
  const [sectionCollapsed, toggleCollapsed] = useSectionCollapse("teamspaces");

  const reload = useCallback(async () => {
    const res = await fetch("/api/teamspaces");
    if (res.ok) setTeamspaces((await res.json()).teamspaces ?? []);
  }, []);

  // Re-fetch when the active workspace changes (switch → server refresh → new prop).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/teamspaces");
      if (res.ok && alive) setTeamspaces((await res.json()).teamspaces ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  async function create() {
    const n = name.trim();
    if (!n) return;
    const res = await fetch("/api/teamspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    if (res.ok) {
      setName("");
      setCreating(false);
      await reload();
    }
  }

  async function addPage(teamspaceId: string) {
    const page = await createPage(null, teamspaceId);
    expand(`ts-${teamspaceId}`);
    router.push(`/p/${page.id}`);
  }

  return (
    <section className="mb-4" data-testid="teamspaces-section">
      <div className="flex items-center justify-between px-2 py-1">
        <button
          data-testid="sidebar-section-toggle-teamspaces"
          onClick={toggleCollapsed}
          className="text-xs font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          Teamspaces
        </button>
        <button
          data-testid="teamspace-create"
          onClick={() => setCreating((v) => !v)}
          className="rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-600 dark:hover:bg-neutral-700"
          aria-label="New teamspace"
        >
          <Plus size={14} />
        </button>
      </div>

      {creating && (
        <div className="px-2 py-1">
          <input
            autoFocus
            data-testid="teamspace-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Teamspace name"
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-neutral-900"
          />
        </div>
      )}

      {teamspaces.length === 0 && !creating && (
        <p className="px-2 py-1 text-xs text-neutral-400">No teamspaces yet</p>
      )}

      {!sectionCollapsed && teamspaces.map((ts) => {
        const key = `ts-${ts.id}`;
        const isOpen = expanded[key] ?? false;
        const tsPages = byTeamspace.get(ts.id) ?? [];
        return (
          <div key={ts.id}>
            <div className="group flex items-center rounded-md pr-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-200/50 dark:text-neutral-400 dark:hover:bg-neutral-800">
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
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-all hover:bg-neutral-300/60 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-700"
                aria-label="Add page to teamspace"
              >
                <Plus size={14} />
              </button>
            </div>
            {isOpen &&
              (tsPages.length === 0 ? (
                <p
                  className="py-1 text-xs text-neutral-400"
                  style={{ paddingLeft: "36px" }}
                >
                  No pages inside
                </p>
              ) : (
                tsPages.map((p) => <PageItem key={p.id} page={p} depth={1} />)
              ))}
          </div>
        );
      })}
    </section>
  );
}
