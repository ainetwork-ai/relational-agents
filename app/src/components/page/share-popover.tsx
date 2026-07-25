"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Link as LinkIcon, UserPlus } from "lucide-react";
import { copyText } from "@/lib/compat";
import { MemorySelect } from "@/components/database/memory-select";

const PERMS = ["view", "comment", "edit", "full"] as const;
type Perm = (typeof PERMS)[number];
const PERM_LABEL: Record<Perm, string> = {
  view: "Can view",
  comment: "Can comment",
  edit: "Can edit",
  full: "Full access",
};
const PERM_OPTIONS = PERMS.map((p) => ({ value: p, label: PERM_LABEL[p] }));

interface Member {
  user: { id: string; displayName: string; avatarUrl?: string | null };
  permission: string;
}
interface Invite {
  email: string;
  permission: string;
  pending: true;
}
interface WsMember {
  id: string;
  displayName: string;
}

export function SharePopover({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "publish">("share");
  const [token, setToken] = useState<string | null>(null);
  const [linkPerm, setLinkPerm] = useState<Perm>("view");
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string>(""); // yyyy-mm-dd, "" = never
  const [hasPassword, setHasPassword] = useState(false);
  const [pwDraft, setPwDraft] = useState("");
  const [allowDuplicate, setAllowDuplicate] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [wsMembers, setWsMembers] = useState<WsMember[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [perm, setPerm] = useState<Perm>("edit");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const loadPeople = useCallback(async () => {
    const [people, ws] = await Promise.all([
      fetch(`/api/pages/${pageId}/members`).then((r) =>
        r.ok ? r.json() : { members: [], invites: [] }
      ),
      fetch(`/api/workspace/members`).then((r) => (r.ok ? r.json() : { members: [] })),
    ]);
    setMembers(people.members ?? []);
    setInvites(people.invites ?? []);
    setWsMembers(ws.members ?? []);
  }, [pageId]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
 // deferred (async IIFE) so no setState runs synchronously in the effect body
    void (async () => {
      const [share, people, ws] = await Promise.all([
        fetch(`/api/pages/${pageId}/share`).then((r) => (r.ok ? r.json() : { token: null })),
        fetch(`/api/pages/${pageId}/members`).then((r) =>
          r.ok ? r.json() : { members: [], invites: [] }
        ),
        fetch(`/api/workspace/members`).then((r) => (r.ok ? r.json() : { members: [] })),
      ]);
      if (!alive) return;
 // don't let this async open-load clobber a token the user just published
 // (the POST can land before this fetch resolves)
      setToken((prev) => share.token ?? prev);
      if (share.token) {
        setLinkPerm(PERMS.includes(share.permission) ? share.permission : "view");
        setExpiresAt(share.expiresAt ? String(share.expiresAt).slice(0, 10) : "");
        setHasPassword(!!share.hasPassword);
        setAllowDuplicate(share.allowDuplicate !== false);
      }
      setMembers(people.members ?? []);
      setInvites(people.invites ?? []);
      setWsMembers(ws.members ?? []);
    })();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      alive = false;
      document.removeEventListener("mousedown", close);
    };
  }, [open, pageId]);

  const link = token ? `${window.location.origin}/share/${token}` : "";

  async function patchLink(body: Record<string, unknown>) {
    await fetch(`/api/pages/${pageId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function invite() {
    const value = email.trim();
    if (!value) return;
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: value, permission: perm }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not invite");
      return;
    }
    setEmail("");
    await loadPeople();
  }
  async function addMember(userId: string) {
    await fetch(`/api/pages/${pageId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, permission: "edit" }),
    });
    setPickerOpen(false);
    await loadPeople();
  }
  async function setMemberPerm(userId: string, permission: string) {
 // optimistic: keep the controlled <select> in sync before the round-trip
    setMembers((ms) => ms.map((m) => (m.user.id === userId ? { ...m, permission } : m)));
    await fetch(`/api/pages/${pageId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, permission }),
    });
    await loadPeople();
  }
  async function setInvitePerm(inviteEmail: string, permission: string) {
    setInvites((is) =>
      is.map((i) => (i.email === inviteEmail ? { ...i, permission } : i))
    );
    await fetch(`/api/pages/${pageId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, permission }),
    });
    await loadPeople();
  }
  async function remove(query: string) {
    await fetch(`/api/pages/${pageId}/members?${query}`, { method: "DELETE" });
    await loadPeople();
  }
  async function changeLinkPerm(next: Perm) {
    setLinkPerm(next);
    await fetch(`/api/pages/${pageId}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: next }),
    });
  }

  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = wsMembers.filter((w) => !memberIds.has(w.id));

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="share-button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-2.5 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        Share
      </button>

      {open && (
        <div className="popover-anim absolute right-0 top-9 z-40 w-96 rounded-lg border border-neutral-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {/* ── Share / Publish tabs (the export structure) ────────────── */}
          <div className="mb-3 flex items-center gap-4 border-b border-neutral-100 px-1 dark:border-neutral-700">
            <button
              data-testid="share-tab-share"
              onClick={() => setTab("share")}
              className={
                tab === "share"
                  ? "-mb-px border-b-2 border-neutral-800 pb-1.5 text-sm font-medium text-neutral-800 dark:border-neutral-200 dark:text-neutral-100"
                  : "pb-1.5 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }
            >
              Share
            </button>
            <button
              data-testid="share-tab-publish"
              onClick={() => setTab("publish")}
              className={
                (tab === "publish"
                  ? "-mb-px border-b-2 border-neutral-800 pb-1.5 text-sm font-medium text-neutral-800 dark:border-neutral-200 dark:text-neutral-100"
                  : "pb-1.5 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200") +
                " flex items-center gap-1.5"
              }
            >
              Publish
              {token && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </button>
          </div>

          {tab === "share" && (
          <div>
          {/* ── Invite specific people ─────────────────────────────── */}
          <div className="mb-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                Invite people
              </span>
              <div className="relative">
                <button
                  data-testid="share-add-person"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700"
                >
                  <UserPlus size={13} /> Add member
                </button>
                {pickerOpen && (
                  <div className="popover-anim absolute right-0 top-8 z-50 max-h-48 w-52 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
                    {candidates.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-neutral-400">
                        No other members
                      </div>
                    ) : (
                      candidates.map((w) => (
                        <button
                          key={w.id}
                          data-testid={`share-person-${w.id}`}
                          onClick={() => void addMember(w.id)}
                          className="w-full truncate rounded px-2 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          {w.displayName}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-1.5">
              <input
                data-testid="page-invite-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void invite();
                }}
                placeholder="Email…"
                className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700 outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
              />
              <MemorySelect
                testid="page-invite-permission"
                value={perm}
                options={PERM_OPTIONS}
                onChange={(v) => setPerm(v as Perm)}
              />
              <button
                data-testid="page-invite-submit"
                onClick={() => void invite()}
                className="shrink-0 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
              >
                Invite
              </button>
            </div>
            {error && (
              <div data-testid="page-invite-error" className="mt-1 text-xs text-red-500">
                {error}
              </div>
            )}

            {/* people with access */}
            <div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
              {members.map((m) => (
                <div
                  key={m.user.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-700/50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-medium text-neutral-600 dark:bg-neutral-600 dark:text-neutral-200">
                    {m.user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-200">
                    {m.user.displayName}
                  </span>
                  <MemorySelect
                    testid={`share-person-permission-${m.user.id}`}
                    value={PERMS.includes(m.permission as Perm) ? (m.permission as Perm) : "view"}
                    options={PERM_OPTIONS}
                    onChange={(v) => void setMemberPerm(m.user.id, v)}
                  />
                  <button
                    data-testid={`share-person-remove-${m.user.id}`}
                    onClick={() => void remove(`userId=${m.user.id}`)}
                    className="text-xs text-neutral-400 hover:text-red-500"
                    aria-label="Remove access"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {invites.map((i) => (
                <div
                  key={i.email}
                  data-testid={`page-access-row-${i.email}`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-700/50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-medium text-amber-700 dark:bg-amber-800 dark:text-amber-200">
                    {i.email.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-200">
                    {i.email}
                    <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      guest · pending
                    </span>
                  </span>
                  <MemorySelect
                    testid={`page-access-perm-${i.email}`}
                    value={PERMS.includes(i.permission as Perm) ? (i.permission as Perm) : "edit"}
                    options={PERM_OPTIONS}
                    onChange={(v) => void setInvitePerm(i.email, v)}
                  />
                  <button
                    data-testid={`page-access-remove-${i.email}`}
                    onClick={() => void remove(`email=${encodeURIComponent(i.email)}`)}
                    className="text-xs text-neutral-400 hover:text-red-500"
                    aria-label="Remove invite"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="my-2 border-t border-neutral-100 dark:border-neutral-700" />
          <button
            data-testid="share-bottom-copy-link"
            onClick={async () => {
              const url = token ? link : window.location.href;
              if (await copyText(url)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            <LinkIcon size={13} className="text-neutral-400" />
            {copied ? "Copied!" : "Copy link"}
          </button>
          </div>
          )}

          {tab === "publish" && (<div>
          {/* ── Share to web ───────────────────────────────────────── */}
          {token ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                <span className="flex items-center gap-2">
                  <Globe size={14} className="text-blue-500" />
                  Anyone with the link can
                </span>
                <MemorySelect
                  testid="share-link-permission"
                  value={linkPerm}
                  options={PERM_OPTIONS}
                  onChange={(v) => void changeLinkPerm(v as Perm)}
                />
              </div>
              <div className="flex gap-1.5">
                <input
                  readOnly
                  data-testid="share-link-input"
                  value={link}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 outline-none dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
                />
                <button
                  data-testid="share-copy"
                  onClick={async () => {
                    if (await copyText(link)) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }
                  }}
                  className="shrink-0 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {/* ── Link options: expiry / password / duplicate ── */}
              <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-neutral-100 p-2 text-xs dark:border-neutral-700">
                <label className="flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
                  Link expires
                  <input
                    type="date"
                    data-testid="share-expiry-input"
                    value={expiresAt}
                    onChange={(e) => {
                      setExpiresAt(e.target.value);
                      void patchLink({ expiresAt: e.target.value || null });
                    }}
                    className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 outline-none dark:border-neutral-600 dark:text-neutral-300"
                  />
                </label>
                <div className="flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
                  <span>Password</span>
                  <span className="flex items-center gap-1">
                    <input
                      type="password"
                      data-testid="share-password-input"
                      value={pwDraft}
                      onChange={(e) => setPwDraft(e.target.value)}
                      placeholder={hasPassword ? "••••• (set)" : "None"}
                      className="w-24 rounded border border-neutral-200 bg-transparent px-1 py-0.5 outline-none dark:border-neutral-600 dark:text-neutral-300"
                    />
                    <button
                      data-testid="share-password-set"
                      onClick={() => {
                        void patchLink({ password: pwDraft });
                        setHasPassword(pwDraft.length > 0);
                        setPwDraft("");
                      }}
                      className="rounded border border-neutral-200 px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    >
                      {hasPassword ? "Update" : "Set"}
                    </button>
                    {hasPassword && (
                      <button
                        data-testid="share-password-clear"
                        onClick={() => {
                          void patchLink({ password: null });
                          setHasPassword(false);
                          setPwDraft("");
                        }}
                        className="rounded px-1 py-0.5 text-neutral-400 hover:text-red-500"
                        aria-label="Remove password"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
                <label className="flex items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
                  Allow duplicate as template
                  <input
                    type="checkbox"
                    data-testid="share-allow-duplicate"
                    checked={allowDuplicate}
                    onChange={(e) => {
                      setAllowDuplicate(e.target.checked);
                      void patchLink({ allowDuplicate: e.target.checked });
                    }}
                  />
                </label>
              </div>
              <button
                data-testid="share-disable"
                onClick={async () => {
                  await fetch(`/api/pages/${pageId}/share`, { method: "DELETE" });
                  setToken(null);
                }}
                className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Unpublish
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-1 flex flex-col items-center gap-1 py-3 text-center">
                <Globe size={22} className="text-neutral-300 dark:text-neutral-500" />
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                  Publish to web
                </div>
                <p className="text-xs text-neutral-400">
                  Create a website with this page. Anyone with the link can view it.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  data-testid="share-publish-preview"
                  className="min-w-0 flex-1 truncate rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-400 dark:border-neutral-600 dark:bg-neutral-900"
                >
                  {typeof window !== "undefined" ? `${window.location.host}/share/…` : "/share/…"}
                </div>
                <button
                  data-testid="share-enable"
                  onClick={async () => {
                    const res = await fetch(`/api/pages/${pageId}/share`, {
                      method: "POST",
                    });
                    if (res.ok) {
                      const d = await res.json();
                      setToken(d.token);
                      setLinkPerm(PERMS.includes(d.permission) ? d.permission : "view");
                    }
                  }}
                  className="shrink-0 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600"
                >
                  Publish
                </button>
              </div>
            </div>
          )}
          </div>)}
        </div>
      )}
    </div>
  );
}
