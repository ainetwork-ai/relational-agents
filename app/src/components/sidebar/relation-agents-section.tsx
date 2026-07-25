"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pencil, Check } from "lucide-react";
import { useDmEvents } from "@/hooks/use-dm-events";

interface RelAgent {
  agentUserId: string;
  displayName: string;
  avatarUrl: string | null;
  roomId: string;
  roomName: string;
}

/** Sidebar "Agents" section — the relationship agents born from your DM
 *  contracts. One per relationship; click to open its room, pencil to rename. */
export function RelationAgentsSection() {
  const router = useRouter();
  const [agents, setAgents] = useState<RelAgent[]>([]);
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/agent/mine");
    if (res.ok) setAgents((await res.json()).agents ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // a new agent is born (consent) or renamed → a dm-room event fires
  useDmEvents(
    (e) => {
      if (e.type === "dm-room") void load();
    },
    () => void load()
  );

  async function rename(a: RelAgent) {
    const name = draft.trim();
    setRenameFor(null);
    if (!name || name === a.displayName) return;
    await fetch(`/api/dm/rooms/${a.roomId}/agent`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    void load();
  }

  return (
    <div className="mt-1">
      <div className="px-2 py-1 text-xs font-medium text-neutral-400">Agents</div>
      {agents.length === 0 ? (
        <div className="px-2 py-1 text-xs text-neutral-400">
          None yet — agents are born when a relationship is signed.
        </div>
      ) : (
        agents.map((a) => (
          <div
            key={a.agentUserId}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {a.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.avatarUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
            ) : (
              <Bot size={14} className="shrink-0 text-purple-500" />
            )}
            {renameFor === a.agentUserId ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rename(a);
                  if (e.key === "Escape") setRenameFor(null);
                }}
                onBlur={() => void rename(a)}
                className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 text-sm outline-none dark:border-neutral-600 dark:bg-neutral-900"
              />
            ) : (
              <button
                onClick={() => router.push(`/dm/${a.roomId}`)}
                className="min-w-0 flex-1 truncate text-left"
                title={a.roomName}
              >
                {a.displayName}
              </button>
            )}
            <button
              onClick={() => {
                if (renameFor === a.agentUserId) void rename(a);
                else {
                  setDraft(a.displayName);
                  setRenameFor(a.agentUserId);
                }
              }}
              className="shrink-0 rounded p-0.5 text-neutral-400 opacity-0 hover:text-neutral-600 group-hover:opacity-100"
              aria-label="Rename agent"
            >
              {renameFor === a.agentUserId ? <Check size={12} /> : <Pencil size={12} />}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
