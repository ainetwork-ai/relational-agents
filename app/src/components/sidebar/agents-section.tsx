"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Pencil,
  Star,
  StarOff,
  Smile,
  Copy,
  Share2,
  FileText,
  X,
} from "lucide-react";
import { useAiAgentsStore } from "@/stores/ai-agents";
import { useAiChatsStore } from "@/stores/ai-chats";
import { useToastStore } from "@/stores/toast";
import { IconPicker } from "@/components/page/icon-picker";
import { PageIcon } from "@/components/page-icon";
import type { AiAgent } from "@/lib/db/schema";

interface ScopePage {
  id: string;
  title: string;
  icon: string | null;
}

/** 사이드바 Chats 탭 상단의 Custom Agents 섹션. 저장된 지침(instructions)으로
 *  새 AI 채팅을 시작하는 프리셋 — 목록/생성/이름변경/아이콘/즐겨찾기/복제/공유/삭제. */
export function AgentsSection() {
  const router = useRouter();
  const agents = useAiAgentsStore((s) => s.agents);
  const loaded = useAiAgentsStore((s) => s.loaded);
  const load = useAiAgentsStore((s) => s.load);
  const create = useAiAgentsStore((s) => s.create);
  const patch = useAiAgentsStore((s) => s.patch);
  const remove = useAiAgentsStore((s) => s.remove);
  const duplicate = useAiAgentsStore((s) => s.duplicate);
  const show = useToastStore((s) => s.show);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [scopeMenuFor, setScopeMenuFor] = useState<string | null>(null);
  const [scopePages, setScopePages] = useState<ScopePage[]>([]);
  const [scopePagesLoaded, setScopePagesLoaded] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (renameFor) renameRef.current?.focus();
  }, [renameFor]);

  function closeOverlays() {
    setMenuFor(null);
    setIconFor(null);
    setEditFor(null);
    setScopeMenuFor(null);
    setConfirmDel(null);
  }

  async function newAgent() {
    const agent = await create();
    closeOverlays();
    startRename(agent.id, agent.name);
  }

  async function openAgent(agentId: string, name: string) {
    const chat = await useAiChatsStore.getState().create({ agentName: name });
    void patch(agentId, { lastUsedAt: true });
    router.push(`/chat/${chat.id}`);
  }

  function startRename(id: string, current: string) {
    closeOverlays();
    setRenameDraft(current);
    setRenameFor(id);
  }

  async function commitRename(id: string) {
    const name = renameDraft.trim();
    setRenameFor(null);
    await patch(id, { name: name || "New agent" });
  }

  function startEdit(a: AiAgent) {
    closeOverlays();
    setEditDraft(a.instructions);
    setScopeDraft(a.knowledgeScope?.pageIds ?? []);
    setEditFor(a.id);
  }

  async function saveInstructions(id: string) {
    await patch(id, { instructions: editDraft, knowledgeScope: { pageIds: scopeDraft } });
    setEditFor(null);
  }

  /** 지식 범위 "페이지 추가" 드롭다운 토글 — 처음 열 때만 /api/pages를 불러온다. */
  async function openScopeMenu(id: string) {
    if (scopeMenuFor === id) {
      setScopeMenuFor(null);
      return;
    }
    if (!scopePagesLoaded) {
      const r = await fetch("/api/pages");
      if (r.ok) {
        const { pages } = (await r.json()) as { pages: ScopePage[] };
        setScopePages(pages);
      }
      setScopePagesLoaded(true);
    }
    setScopeMenuFor(id);
  }

  function addScopePage(pageId: string) {
    setScopeDraft((prev) => (prev.includes(pageId) ? prev : [...prev, pageId]));
    setScopeMenuFor(null);
  }

  function removeScopePage(pageId: string) {
    setScopeDraft((prev) => prev.filter((id) => id !== pageId));
  }

  async function doDuplicate(id: string) {
    setMenuFor(null);
    await duplicate(id);
    show("Agent duplicated");
  }

  async function doDelete(id: string) {
    setConfirmDel(null);
    setMenuFor(null);
    await remove(id);
    show("Agent deleted");
  }

  // 최근 사용한 에이전트(lastUsedAt 있는 것) 최대 3개를 상단 "최근" 서브섹션에,
  // 나머지는 기존 목록에 그대로 둔다.
  const recentAgents = [...agents]
    .filter((a) => a.lastUsedAt)
    .sort((a, b) => new Date(b.lastUsedAt as unknown as string).getTime() - new Date(a.lastUsedAt as unknown as string).getTime())
    .slice(0, 3);
  const recentIds = new Set(recentAgents.map((a) => a.id));
  const restAgents = agents.filter((a) => !recentIds.has(a.id));

  function renderAgent(a: AiAgent) {
    return (
          <div
            key={a.id}
            data-testid={`agent-item-${a.id}`}
            className="group/agent relative flex items-center rounded-md pr-1 transition-colors hover:bg-neutral-200/50 dark:hover:bg-neutral-800"
          >
            {renameFor === a.id ? (
              <input
                ref={renameRef}
                data-testid={`agent-rename-input-${a.id}`}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename(a.id);
                  else if (e.key === "Escape") setRenameFor(null);
                }}
                onBlur={() => void commitRename(a.id)}
                className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-sm outline-none ring-1 ring-blue-400 dark:bg-neutral-900"
              />
            ) : (
              <button
                data-testid={`agent-open-${a.id}`}
                onClick={() => void openAgent(a.id, a.name)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-sm text-neutral-600 dark:text-neutral-400"
              >
                <span className="shrink-0 text-[15px] leading-none">
                  <PageIcon icon={a.icon} fallback="🤖" />
                </span>
                <span className="truncate">{a.name}</span>
                {a.isFavorite && <Star size={11} className="shrink-0 text-amber-400" />}
              </button>
            )}

            <button
              data-testid={`agent-menu-${a.id}`}
              onClick={() => {
                const next = menuFor === a.id ? null : a.id;
                closeOverlays();
                setMenuFor(next);
              }}
              aria-label="Agent options"
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-600 group-hover/agent:flex dark:hover:bg-neutral-700"
            >
              <MoreHorizontal size={14} />
            </button>

            {menuFor === a.id && (
              <div
                data-testid={`agent-menu-popover-${a.id}`}
                className="popover-anim absolute right-1 top-7 z-50 w-48 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
                onMouseLeave={() => setMenuFor(null)}
              >
                <button
                  data-testid={`agent-rename-${a.id}`}
                  onClick={() => startRename(a.id, a.name)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Pencil size={13} /> Rename
                </button>
                <button
                  data-testid={`agent-icon-${a.id}`}
                  onClick={() => {
                    const next = iconFor === a.id ? null : a.id;
                    closeOverlays();
                    setIconFor(next);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Smile size={13} /> Change icon
                </button>
                <button
                  data-testid={`agent-edit-${a.id}`}
                  onClick={() => startEdit(a)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <FileText size={13} /> Edit instructions
                </button>
                <button
                  data-testid={`agent-fav-${a.id}`}
                  onClick={() => {
                    void patch(a.id, { isFavorite: !a.isFavorite });
                    setMenuFor(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {a.isFavorite ? <StarOff size={13} /> : <Star size={13} />}
                  {a.isFavorite ? "Remove from favorites" : "Add to favorites"}
                </button>
                <button
                  data-testid={`agent-duplicate-${a.id}`}
                  onClick={() => void doDuplicate(a.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Copy size={13} /> Duplicate
                </button>
                <button
                  data-testid={`agent-share-${a.id}`}
                  onClick={() => {
                    void patch(a.id, { isShared: !a.isShared });
                    setMenuFor(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <Share2 size={13} /> {a.isShared ? "Stop sharing" : "Share with workspace"}
                </button>
                <button
                  data-testid={`agent-delete-${a.id}`}
                  onClick={() => {
                    setConfirmDel(a.id);
                    setMenuFor(null);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}

            {iconFor === a.id && (
              <div className="absolute right-1 top-7 z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
                <IconPicker
                  icon={a.icon}
                  testid={`agent-iconpicker-trigger-${a.id}`}
                  pickerTestid={`agent-iconpicker-${a.id}`}
                  triggerClassName="rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  placeholder="Pick an icon"
                  onChange={(icon) => {
                    void patch(a.id, { icon });
                    setIconFor(null);
                  }}
                />
              </div>
            )}

            {editFor === a.id && (
              <div
                data-testid={`agent-instructions-panel-${a.id}`}
                className="absolute right-1 top-7 z-50 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
              >
                <p className="mb-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  Agent instructions
                </p>
                <textarea
                  data-testid={`agent-instructions-${a.id}`}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={5}
                  placeholder="Instructions this agent always follows"
                  className="w-full resize-none rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                />

                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      Knowledge scope
                    </p>
                    <button
                      type="button"
                      data-testid={`agent-scope-add-${a.id}`}
                      onClick={() => void openScopeMenu(a.id)}
                      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    >
                      <Plus size={11} /> Add page
                    </button>
                  </div>

                  {scopeDraft.length > 0 && (
                    <div className="mb-1 flex flex-wrap gap-1">
                      {scopeDraft.map((pageId) => {
                        const sp = scopePages.find((p) => p.id === pageId);
                        return (
                          <div
                            key={pageId}
                            data-testid={`agent-scope-chip-${pageId}`}
                            className="flex max-w-full items-center gap-1 rounded bg-neutral-100 py-0.5 pl-1.5 pr-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                          >
                            <span className="shrink-0">
                              <PageIcon icon={sp?.icon} fallback="📄" />
                            </span>
                            <span className="truncate">{sp?.title || pageId}</span>
                            <button
                              type="button"
                              data-testid={`agent-scope-remove-${pageId}`}
                              onClick={() => removeScopePage(pageId)}
                              aria-label="Remove page"
                              className="shrink-0 rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {scopeMenuFor === a.id && (
                    <div
                      data-testid={`agent-scope-menu-${a.id}`}
                      className="mb-1 max-h-32 overflow-y-auto rounded border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {scopePages.length === 0 ? (
                        <p className="px-2 py-1.5 text-[11px] text-neutral-400">No pages</p>
                      ) : (
                        scopePages.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            data-testid={`agent-scope-item-${p.id}`}
                            onClick={() => addScopePage(p.id)}
                            className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          >
                            <span className="shrink-0">
                              <PageIcon icon={p.icon} fallback="📄" />
                            </span>
                            <span className="truncate">{p.title}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setEditFor(null)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid={`agent-save-${a.id}`}
                    onClick={() => void saveInstructions(a.id)}
                    className="rounded bg-neutral-800 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {confirmDel === a.id && (
              <div
                data-testid={`agent-delete-modal-${a.id}`}
                className="absolute right-1 top-7 z-50 w-52 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
              >
                <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">
                  Delete this agent? This cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    data-testid={`agent-delete-cancel-${a.id}`}
                    onClick={() => setConfirmDel(null)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    data-testid={`agent-delete-confirm-${a.id}`}
                    onClick={() => void doDelete(a.id)}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
    );
  }

  return (
    <div data-testid="agents-section">
      <div className="mt-1 flex items-center justify-between px-2 pb-1 pt-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Agents
        </h3>
        <button
          data-testid="agent-new"
          onClick={() => void newAgent()}
          aria-label="New agent"
          data-tip="New agent"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-neutral-200/70 hover:text-neutral-700 active:scale-90 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={17} strokeWidth={2.2} />
        </button>
      </div>

      {!loaded ? (
        <div className="space-y-1.5 px-2 py-1">
          {[0, 1].map((i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-neutral-400" data-testid="agents-empty">
          No agents yet.
        </p>
      ) : (
        <>
          {recentAgents.length > 0 && (
            <div data-testid="agents-recent-section" className="mb-1">
              <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Recent
              </p>
              {recentAgents.map(renderAgent)}
            </div>
          )}
          {restAgents.map(renderAgent)}
        </>
      )}
    </div>
  );
}
