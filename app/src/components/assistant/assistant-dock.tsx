"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, Send, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMe } from "@/stores/me";
import { useLocale, useT } from "@/i18n/provider";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { openFamilySheet } from "@/components/family/family-folders";

interface Assistant {
  roomId: string;
  teamspaceId: string | null;
  agentId: string | null;
  agentName: string;
  workspaceName: string | null;
  drives: { label: string; owner: string | null; online: boolean }[];
}

interface Msg {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

const POLL_MS = 2000;
/** drive chips shown before "+N more" — switched-on ones first */
const CHIPS = 8;
const SUGGESTIONS = {
  ko: ["오늘 여행사진 정리해서 앨범으로 만들어줘.", "녹두전 4인분 장보기 목록 만들어줘", "추석날 할머니 아침 약은 몇 시야?"],
  en: [
    "Make an album from today's trip photos.",
    "Make a shopping list for nokdujeon for 4.",
    "What time does grandma take her morning medicine on Chuseok?",
  ],
};

/** "/p/<id>" in an answer is a page the agent made — a link, not text. */
function Linked({ text, label }: { text: string; label: string }) {
  const parts = text.split(/(\/p\/[0-9a-f-]{36})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\/p\/[0-9a-f-]{36}$/.test(part) ? (
          <Link key={i} href={part} className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">
            {label}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

/**
 * The round agent button, bottom right, on every page. It opens a panel on the
 * right: the person's own agent in this workspace, with the aindrive folders
 * it reads — every family member's phone, as shared into the teamspaces.
 */
export function AssistantDock({ workspaceId }: { workspaceId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const me = useMe();
  const pathname = usePathname();
  const aindrive = useAindriveInfo();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<Assistant | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  // the last question's message id ("sending" until the server has it); the
  // "thinking" line shows until an agent message comes after it
  const [asked, setAsked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (roomId: string) => {
    const r = await fetch(`/api/dm/rooms/${roomId}/messages`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { messages?: Msg[] };
    setMsgs(d.messages ?? []);
  }, []);

  // another workspace (the page being viewed moved) is another agent
  const [forWs, setForWs] = useState(workspaceId);
  if (forWs !== workspaceId) {
    setForWs(workspaceId);
    setA(null);
    setMsgs([]);
  }

  useEffect(() => {
    if (!open || a) return;
    fetch(`/api/assistant${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Assistant) => {
        setA(d);
        void load(d.roomId);
      })
      .catch(() => setError(t("에이전트를 열지 못했어요.")));
  }, [open, a, load, t, workspaceId]);

  useEffect(() => {
    if (!open || !a) return;
    const timer = setInterval(() => void load(a.roomId), POLL_MS);
    return () => clearInterval(timer);
  }, [open, a, load]);

  const askedIdx = asked ? msgs.findIndex((m) => m.id === asked) : -1;
  const waiting =
    asked !== null && (asked === "sending" || askedIdx < 0 || !msgs.slice(askedIdx + 1).some((m) => m.authorId === a?.agentId));

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, waiting]);

  async function send(text: string) {
    if (!a || !text.trim()) return;
    setDraft("");
    setAsked("sending");
    const r = await fetch(`/api/dm/rooms/${a.roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { message?: { id: string } } | null;
    if (!r?.ok || !d?.message) {
      setAsked(null);
      setError(t("보내지 못했어요."));
    } else setAsked(d.message.id);
    void load(a.roomId);
  }

  if (!open)
    return (
      <button
        data-testid="assistant-dock-button"
        onClick={() => setOpen(true)}
        title={t("에이전트")}
        aria-label={t("에이전트 열기")}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition-transform hover:scale-105 dark:bg-neutral-100 dark:text-neutral-900"
      >
        <Sparkles size={20} />
      </button>
    );

  return (
    <aside
      data-testid="assistant-panel"
      aria-label={t("에이전트")}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#1f1f1f]"
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
          <Sparkles size={14} />
        </span>
        <span className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{a?.agentName ?? t("에이전트")}</span>
        <button onClick={() => setOpen(false)} aria-label={t("닫기")} className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <X size={16} />
        </button>
      </div>
      {a && (
        <div data-testid="assistant-drives" className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
          <div className="mb-1 flex items-center">
            <p className="text-[11px] font-medium text-neutral-400">{t("연동된 aindrive {n}개", { n: a.drives.length })}</p>
            {a.teamspaceId && (
              <button
                data-testid="assistant-family"
                onClick={() => openFamilySheet(a.teamspaceId!)}
                className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
              >
                {t("가족 폴더 · 초대")}
              </button>
            )}
          </div>
          {a.drives.length === 0 && (
            <div data-testid="assistant-no-drives" className="space-y-2 pb-1 text-xs text-neutral-500">
              <p>
                {t("{ws}에는 아직 공유된 aindrive 폴더가 없어요. 내 aindrive를 연결하거나, 폴더를 팀스페이스에 공유하면 여기서 함께 읽어요.", {
                  ws: a.workspaceName ?? t("이 워크스페이스"),
                })}
              </p>
              {aindrive?.configured && !aindrive.connected ? (
                <AindriveConnect compact onConnected={() => setA(null)} />
              ) : (
                <Link
                  href={`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`}
                  className="inline-block rounded-md border border-neutral-200 px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {t("aindrive 폴더 공유하기")}
                </Link>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {[...a.drives].sort((x, y) => Number(y.online) - Number(x.online)).slice(0, CHIPS).map((d) => (
              <span
                key={d.label}
                className="flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                title={d.online ? t("연결됨") : t("꺼져 있음")}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${d.online ? "bg-emerald-500" : "bg-neutral-300"}`} />
                <HardDrive size={10} className="text-neutral-400" />
                {d.owner ? `${d.owner} · ` : ""}
                {d.label}
              </span>
            ))}
            {a.drives.length > CHIPS && (
              <span className="px-1 py-0.5 text-[11px] text-neutral-400">{t("외 {n}개", { n: a.drives.length - CHIPS })}</span>
            )}
          </div>
        </div>
      )}
      <div ref={listRef} data-testid="assistant-messages" className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && a && a.drives.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">{t("가족의 aindrive를 함께 보고 있어요. 무엇을 도와드릴까요?")}</p>
            {(locale === "en" ? SUGGESTIONS.en : SUGGESTIONS.ko).map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.authorId === me?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  mine ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                }`}
              >
                <Linked text={m.text} label={t("페이지 열기")} />
              </div>
            </div>
          );
        })}
        {waiting && <p className="text-xs text-neutral-400">{t("가족 폴더를 살펴보는 중…")}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2 border-t border-neutral-100 p-3 dark:border-neutral-800"
      >
        <input
          data-testid="assistant-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("에이전트에게 부탁하기…")}
          className="flex-1 rounded-full border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
        />
        <button
          type="submit"
          data-testid="assistant-send"
          disabled={!draft.trim() || !a}
          aria-label={t("보내기")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
