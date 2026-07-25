"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useDmRoomsStore, type DmUser } from "@/stores/dm-rooms";
import { useToastStore } from "@/stores/toast";
import { DmAvatar } from "./dm-avatar";

/** New-DM modal — pick people from the workspace (multi-select = group DM). */
export function NewDmModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const create = useDmRoomsStore((s) => s.create);
  const show = useToastStore((s) => s.show);
  const [members, setMembers] = useState<DmUser[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/workspace/members").then((r) => (r.ok ? r.json() : { members: [] })),
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })),
    ]).then(([m, me]) => {
      if (!alive) return;
      const meId = me?.user?.id ?? null;
      setMembers(((m.members ?? []) as DmUser[]).filter((u) => u.id !== meId));
    });
    return () => {
      alive = false;
    };
  }, []);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      const room = await create(selected, selected.length > 1 ? groupName.trim() : undefined);
      onClose();
      router.push(`/dm/${room.id}`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't start the conversation");
      setBusy(false);
    }
  }

  // Portal to <body> so the overlay centers on the whole viewport — rendering
  // inside the sidebar would trap `fixed` under an ancestor transform/overflow.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New relationship"
        data-testid="dm-new-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          New relationship
        </h2>

        {!members ? (
          <div className="space-y-1.5 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-800" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-400" data-testid="dm-no-members">
            No one to invite yet. Add people to this workspace from
            <br />
            Settings first.
          </p>
        ) : (
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {members.map((u) => {
              const on = selected.includes(u.id);
              return (
                <li key={u.id}>
                  <button
                    data-testid={`dm-member-option-${u.id}`}
                    onClick={() => toggle(u.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      on
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <DmAvatar user={u} size={24} />
                    <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                    {u.isAgent && (
                      <span className="rounded bg-purple-100 px-1 text-[10px] text-purple-600 dark:bg-purple-900/40 dark:text-purple-300">
                        AGENT
                      </span>
                    )}
                    {on && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected.length > 1 && (
          <input
            data-testid="dm-group-name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            className="mt-2 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
          />
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            data-testid="dm-create-cancel"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            data-testid="dm-create"
            onClick={() => void submit()}
            disabled={selected.length === 0 || busy}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start chat"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
