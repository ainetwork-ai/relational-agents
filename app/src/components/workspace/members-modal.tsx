"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, UserPlus, Copy } from "lucide-react";
import { useWorkspaceUiStore } from "@/stores/workspace-ui";
import { copyText } from "@/lib/compat";
import type { PublicUser } from "@/lib/auth/public-user";

interface MemberRow {
  user: PublicUser;
  role: string;
}

interface GuestGrant {
  pageId: string;
  permission: string;
  title: string;
  user: PublicUser;
}
interface GuestInvite {
  pageId: string;
  permission: string;
  email: string;
  title: string;
}

const ASSIGNABLE_ROLES = ["guest", "member", "admin"] as const;
const ROLE_RANK: Record<string, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export function MembersModal() {
  const open = useWorkspaceUiStore((s) => s.membersOpen);
  const setOpen = useWorkspaceUiStore((s) => s.setMembersOpen);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [guestGrants, setGuestGrants] = useState<GuestGrant[]>([]);
  const [guestInvites, setGuestInvites] = useState<GuestInvite[]>([]);
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/workspace/members");
    if (!res.ok) return;
    const data = await res.json();
    const list: (PublicUser & { role?: string })[] = data.members ?? [];
    setMembers(list.map((m) => ({ user: m, role: m.role ?? "member" })));
    const g = await fetch("/api/workspace/guests");
    if (g.ok) {
      const gd = await g.json();
      setGuestGrants(gd.grants ?? []);
      setGuestInvites(gd.invites ?? []);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const [meRes] = await Promise.all([fetch("/api/auth/me")]);
      if (meRes.ok && alive) setMeId((await meRes.json()).user?.id ?? null);
      await loadMembers();
      const inv = await fetch("/api/workspace/invite");
      if (inv.ok && alive) {
        const d = await inv.json();
        if (d.invite?.url) setInviteUrl(d.invite.url);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, loadMembers]);

  const myRole = members.find((m) => m.user.id === meId)?.role ?? "member";
  const canManage = ROLE_RANK[myRole] >= ROLE_RANK.admin;

  async function changeRole(userId: string, role: string) {
    setMembers((ms) => ms.map((m) => (m.user.id === userId ? { ...m, role } : m)));
    await fetch("/api/workspace/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    await loadMembers();
  }
  async function removeMember(userId: string) {
    await fetch(`/api/workspace/members?userId=${userId}`, { method: "DELETE" });
    await loadMembers();
  }
  async function revokeGrant(pageId: string, q: string) {
    await fetch(`/api/pages/${pageId}/members?${q}`, { method: "DELETE" });
    await loadMembers();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  async function createInvite() {
    const res = await fetch("/api/workspace/invite", { method: "POST" });
    if (res.ok) setInviteUrl((await res.json()).url);
  }

  // Portal to <body> — this renders inside the workspace switcher, and a
  // transformed ancestor would trap `fixed` inside the sidebar.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Workspace members"
        data-testid="members-modal"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            Members
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700"
            aria-label="Close members"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[45vh] overflow-y-auto p-2">
          {members.map(({ user, role }) => {
 // an admin+ can manage everyone except the owner and themselves
            const editable = canManage && role !== "owner" && user.id !== meId;
            return (
              <div
                key={user.id}
                data-testid={`member-row-${user.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-300"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-medium text-neutral-600 dark:bg-neutral-600 dark:text-neutral-200">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
                {editable ? (
                  <>
                    <select
                      data-testid={`member-role-select-${user.id}`}
                      value={ASSIGNABLE_ROLES.includes(role as (typeof ASSIGNABLE_ROLES)[number]) ? role : "member"}
                      onChange={(e) => void changeRole(user.id, e.target.value)}
                      className="shrink-0 rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs capitalize text-neutral-500 outline-none dark:border-neutral-600 dark:text-neutral-300"
                    >
                      {ASSIGNABLE_ROLES.filter((r) => ROLE_RANK[r] <= ROLE_RANK[myRole]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      data-testid={`member-remove-${user.id}`}
                      onClick={() => void removeMember(user.id)}
                      aria-label="Remove member"
                      className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <span
                    data-testid={`member-role-${user.id}`}
                    className="shrink-0 text-xs capitalize text-neutral-400"
                  >
                    {role}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {(guestGrants.length > 0 || guestInvites.length > 0) && (
          <div
            data-testid="guests-section"
            className="max-h-[25vh] overflow-y-auto border-t border-neutral-100 px-4 py-3 dark:border-neutral-700"
          >
            <div className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              Guest access — page-level grants
            </div>
            {guestGrants.map((g) => (
              <div
                key={`${g.pageId}-${g.user.id}`}
                data-testid={`guest-row-${g.user.id}-${g.pageId}`}
                className="flex items-center gap-2 rounded px-1 py-1 text-xs text-neutral-600 dark:text-neutral-300"
              >
                <span className="min-w-0 flex-1 truncate">
                  {g.user.displayName} · <span className="text-neutral-400">{g.title || "Untitled"}</span>
                </span>
                <span className="shrink-0 capitalize text-neutral-400">{g.permission}</span>
                <button
                  data-testid={`guest-revoke-${g.user.id}-${g.pageId}`}
                  onClick={() => void revokeGrant(g.pageId, `userId=${g.user.id}`)}
                  aria-label="Revoke access"
                  className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {guestInvites.map((g) => (
              <div
                key={`${g.pageId}-${g.email}`}
                data-testid={`guest-invite-row-${g.email}-${g.pageId}`}
                className="flex items-center gap-2 rounded px-1 py-1 text-xs text-neutral-500 dark:text-neutral-400"
              >
                <span className="min-w-0 flex-1 truncate">
                  {g.email} <span className="text-neutral-400">(pending)</span> ·{" "}
                  <span className="text-neutral-400">{g.title || "Untitled"}</span>
                </span>
                <span className="shrink-0 capitalize text-neutral-400">{g.permission}</span>
                <button
                  data-testid={`guest-revoke-invite-${g.email}-${g.pageId}`}
                  onClick={() => void revokeGrant(g.pageId, `email=${encodeURIComponent(g.email)}`)}
                  aria-label="Revoke invite"
                  className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <UserPlus size={13} /> Invite members
          </div>
          {inviteUrl ? (
            <div className="flex gap-1.5">
              <input
                readOnly
                data-testid="invite-link"
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
              />
              <button
                onClick={async () => {
                  if (await copyText(inviteUrl)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900"
              >
                <Copy size={12} />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <button
              data-testid="invite-create"
              onClick={createInvite}
              className="w-full rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              Create invite link
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
