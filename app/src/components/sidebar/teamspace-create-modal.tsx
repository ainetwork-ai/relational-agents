"use client";

import { useEffect, useRef, useState } from "react";
import { Users, X, ChevronDown, Link as LinkIcon, Check } from "lucide-react";
import { useToastStore } from "@/stores/toast";
import { UserAvatar } from "@/components/user-avatar";
import type { TeamspaceVisibility } from "@/lib/db/schema";
import { useT } from "@/i18n/provider";

interface WorkspaceMember {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

const VISIBILITIES: {
  value: TeamspaceVisibility;
  label: string;
  hint: string;
}[] = [
  { value: "open", label: "공개", hint: "누구나 이 팀스페이스를 보고 참여할 수 있음" },
  { value: "closed", label: "비공개", hint: "누구나 찾을 수 있지만, 참여는 초대를 받아야 함" },
  { value: "private", label: "완전 비공개", hint: "멤버만 이 팀스페이스를 보고 참여할 수 있음" },
];


/**
 * Does this member match what was typed?
 *
 * Substring matching over the whole email is useless on a single-domain
 * workspace: every address ends in the same @company, so "m" matched all four
 * members through "comcom". So names match at word starts, and the email
 * matches on its local part — unless the query contains "@", which is a person
 * spelling out an address and expects it matched as one.
 */
function matchesQuery(m: WorkspaceMember, q: string): boolean {
  const email = (m.email ?? "").toLowerCase();
  if (q.includes("@")) return email.includes(q);
  const name = m.displayName.toLowerCase();
  if (name.startsWith(q)) return true;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return true;
  return email.split("@")[0].startsWith(q);
}

/**
 * Teamspace creation, in the two steps Notion uses.
 *
 * Step 1 (팀스페이스 만들기) takes icon + name, description and 보안, and the
 * primary button stays disabled until there is a name — the same rule Notion's
 * dialog uses (aria-disabled on an empty form).
 *
 * Step 2 invites people, and its way out is 건너뛰기: the teamspace already
 * exists after step 1, so skipping must not undo it. Only workspace members can
 * be invited here (see the members route for why).
 */
export function TeamspaceCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const show = useToastStore((s) => s.show);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

  // step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [visibility, setVisibility] = useState<TeamspaceVisibility>("open");
  const [secOpen, setSecOpen] = useState(false);

  // step 2
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The invitee list is the workspace roster; loaded when step 2 opens.
  useEffect(() => {
    if (step !== 2) return;
    let alive = true;
    void (async () => {
      // inside the callback, not the effect body: setting state synchronously
      // there triggers the cascading-render lint rule (and the extra render)
      setLoadingMembers(true);
      const res = await fetch("/api/workspace/members");
      if (!alive) return;
      const data = res.ok ? await res.json() : { members: [] };
      setMembers(
        (data.members ?? []).map((m: { user?: WorkspaceMember } & WorkspaceMember) => m.user ?? m)
      );
      setLoadingMembers(false);
    })();
    return () => {
      alive = false;
    };
  }, [step]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/teamspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, icon: icon || undefined, visibility }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(t("팀스페이스를 만들지 못했습니다: {error}", { error: data?.error ?? res.status }));
        return;
      }
      setCreated({ id: data.teamspace.id, name: data.teamspace.name });
      onCreated(); // the sidebar shows it right away, before the invite step
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!created || !picked.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teamspaces/${created.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds: picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        show(t("초대에 실패했습니다: {error}", { error: data?.error ?? res.status }));
        return;
      }
      show(t("{n}명을 초대했습니다", { n: data.added }));
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // Notion only drops the list open once you type — an always-open roster turns
  // the dialog into a list view. Picked people stay visible as chips instead.
  const q = query.trim().toLowerCase();
  const shown = q ? members.filter((m) => matchesQuery(m, q)) : [];
  const active = VISIBILITIES.find((v) => v.value === visibility)!;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step === 1 ? t("팀스페이스 만들기") : t("팀스페이스 멤버 초대")}
        data-testid="teamspace-create-modal"
        onClick={(e) => e.stopPropagation()}
        className="popover-anim relative w-full max-w-[520px] rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <button
          onClick={onClose}
          aria-label={t("닫기")}
          data-testid="teamspace-modal-close"
          className="absolute right-3 top-3 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
        >
          <X size={16} />
        </button>

        {step === 1 ? (
          <>
            <div className="mb-5 flex items-start gap-2.5">
              <Users size={20} className="mt-0.5 shrink-0 text-neutral-400" />
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  {t("팀스페이스 만들기")}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {t("팀스페이스로 팀의 페이지, 멤버, 사용 권한을 관리할 수 있습니다.")}
                </p>
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-neutral-500">{t("아이콘과 이름")}</label>
            <div className="mb-4 flex items-center gap-2">
              <input
                data-testid="teamspace-icon-input"
                value={icon}
                onChange={(e) => setIcon([...e.target.value].slice(0, 2).join(""))}
                aria-label={t("아이콘")}
                className="h-9 w-9 shrink-0 rounded-md border border-neutral-200 bg-neutral-50 text-center text-lg outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800"
                placeholder={name ? [...name][0] : "T"}
              />
              <input
                ref={nameRef}
                data-testid="teamspace-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                placeholder={t("예: 엔지니어링")}
                className="h-9 flex-1 rounded-md border border-neutral-200 px-2.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800"
              />
            </div>

            <label className="mb-1 block text-xs font-medium text-neutral-500">{t("설명")}</label>
            <textarea
              data-testid="teamspace-description-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("이 팀스페이스의 용도는 무엇인가요?")}
              className="mb-4 w-full resize-none rounded-md border border-neutral-200 p-2.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800"
            />

            <label className="mb-1 block text-xs font-medium text-neutral-500">{t("보안")}</label>
            <div className="relative mb-6">
              <button
                data-testid="teamspace-visibility"
                onClick={() => setSecOpen((v) => !v)}
                aria-expanded={secOpen}
                aria-haspopup="listbox"
                className="flex w-full items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-left hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                <span>
                  <span className="block text-sm text-neutral-800 dark:text-neutral-100">
                    {t(active.label)}
                  </span>
                  <span className="block text-xs text-neutral-500">{t(active.hint)}</span>
                </span>
                <ChevronDown size={14} className="shrink-0 text-neutral-400" />
              </button>
              {secOpen && (
                <div
                  role="listbox"
                  className="popover-anim absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800"
                >
                  {VISIBILITIES.map((v) => (
                    <button
                      key={v.value}
                      role="option"
                      aria-selected={visibility === v.value}
                      data-testid={`teamspace-visibility-${v.value}`}
                      onClick={() => {
                        setVisibility(v.value);
                        setSecOpen(false);
                      }}
                      className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700"
                    >
                      <span className="flex-1">
                        <span className="block text-sm text-neutral-800 dark:text-neutral-100">
                          {t(v.label)}
                        </span>
                        <span className="block text-xs text-neutral-500">{t(v.hint)}</span>
                      </span>
                      {visibility === v.value && (
                        <Check size={14} className="mt-0.5 shrink-0 text-neutral-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end">
              <button
                data-testid="teamspace-create-submit"
                onClick={() => void create()}
                disabled={!name.trim() || busy}
                className="rounded-md bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
              >
                {busy ? t("만드는 중…") : t("팀스페이스 만들기")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
              <span>{t("초대할 팀스페이스:")}</span>
              <span className="flex h-5 w-5 items-center justify-center rounded bg-neutral-200 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
                {icon || [...(created?.name ?? "T")][0]}
              </span>
              <span className="font-medium text-neutral-800 dark:text-neutral-100">
                {created?.name}
              </span>
            </div>

            <input
              autoFocus
              data-testid="teamspace-member-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("사용자나 그룹을 검색하세요")}
              className="mb-2 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800"
            />

            {picked.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {picked.map((id) => {
                  const m = members.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      data-testid={`teamspace-picked-${id}`}
                      onClick={() => setPicked((p) => p.filter((x) => x !== id))}
                      className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      aria-label={t("{name} 선택 해제", { name: m?.displayName ?? id })}
                    >
                      {m?.displayName ?? id}
                      <X size={11} />
                    </button>
                  );
                })}
              </div>
            )}

            {q && (
            <div
              data-testid="teamspace-member-list"
              className="mb-4 max-h-56 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700"
            >
              {loadingMembers ? (
                <p className="px-3 py-2 text-sm text-neutral-400">{t("불러오는 중...")}</p>
              ) : shown.length === 0 ? (
                <p className="px-3 py-2 text-sm text-neutral-400">{t("일치하는 사용자가 없습니다")}</p>
              ) : (
                shown.map((m) => {
                  const on = picked.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      data-testid={`teamspace-invite-${m.id}`}
                      onClick={() =>
                        setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                      }
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <UserAvatar user={{ ...m, displayName: m.displayName || "?" }} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                          {m.displayName}
                        </span>
                        {m.email && (
                          <span className="block truncate text-xs text-neutral-500">{m.email}</span>
                        )}
                      </span>
                      {on && <Check size={14} className="shrink-0 text-blue-500" />}
                    </button>
                  );
                })
              )}
            </div>
            )}

            <div className="flex items-center justify-between">
              <button
                data-testid="teamspace-copy-invite-link"
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.origin);
                  show(t("초대 링크를 복사했습니다"));
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <LinkIcon size={14} /> {t("초대 링크 복사")}
              </button>
              <div className="flex items-center gap-2">
                <button
                  data-testid="teamspace-skip-invite"
                  onClick={onClose}
                  className="rounded-md px-3 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("건너뛰기")}
                </button>
                <button
                  data-testid="teamspace-invite-submit"
                  onClick={() => void invite()}
                  disabled={!picked.length || busy}
                  className="rounded-md bg-blue-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
                >
                  {picked.length ? t("{n}명 초대", { n: picked.length }) : t("초대")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
