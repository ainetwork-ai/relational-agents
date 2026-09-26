"use client";
import { AinuiButton, AinuiText } from "@/components/ainui/surface";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMe } from "@/stores/me";
import { useT } from "@/i18n/provider";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { AindriveConnect } from "@/components/aindrive/aindrive-connect";
import { openFamilySheet } from "@/components/family/family-folders";
import { A2uiSurface } from "@/components/a2ui/surface";
import { splitA2uiMarkers } from "@/lib/agent/treasurer/surfaces";
import { sendOfferSrc } from "@/lib/agent/send-offer-surface";

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
/** English keys; the ko dictionary carries the Korean wording that gets sent. */
const SUGGESTIONS = [
  "Make an album from today's trip photos.",
  "Make a shopping list for nokdujeon for 4.",
  "What time does grandma take her morning medicine on Chuseok?",
];
/** offered on a page: the page open behind the panel goes along as "this page" */
export const PAGE_SUGGESTION = "Turn this page into an AI prompt.";

/** The page open behind the panel (a uuid or an OKF id), if any. */
export const pageIdOf = (pathname: string | null) => pathname?.match(/^\/p\/([A-Za-z0-9_-]{8,})/)?.[1] ?? null;

/**
 * What the panel offers (English keys). Before the first message: a list under
 * the greeting, this page first. The assistant room is made once per person and
 * workspace and then reused, so that list is gone after the first question; the
 * page's own offer then stays as a chip above the composer, because it is the
 * one tied to what is open behind the panel.
 */
export function suggestionsFor(o: { pageId: string | null; hasDrives: boolean; hasHistory: boolean }): {
  list: string[];
  chips: string[];
} {
  const page = o.pageId ? [PAGE_SUGGESTION] : [];
  if (o.hasHistory) return { list: [], chips: page };
  return { list: [...page, ...(o.hasDrives ? SUGGESTIONS : [])], chips: [] };
}

/** a chip is a 36px target where there is no mouse, like the send button next to it */
export const CHIP_CLASS =
  "flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-neutral-200 px-3 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800 [@media(hover:none)]:h-9";

/** Suggestions that stay above the composer once the room has history. */
export function SuggestionChips({ items, onPick, disabled }: { items: string[]; onPick: (text: string) => void; disabled?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div data-testid="assistant-chips" className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1">
      {items.map((s) => (
        <button key={s} type="button" data-testid="assistant-chip" disabled={disabled} onClick={() => onPick(s)} className={CHIP_CLASS}>
          <Sparkles size={12} className="shrink-0 text-neutral-400" />
          <span className="truncate">{s}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * "/p/<id>" in an answer is a page the agent made, "/send?t=…" a transfer to review (older
 * send-by-name answers; it asks in the chat now), and an https url the explorer link on a
 * receipt — links, not text.
 */
function Linked({ text, label }: { text: string; label: string }) {
  const t = useT();
  const parts = text.split(/(\/p\/[0-9a-f-]{36}|\/send\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|https:\/\/[^\s<>"')\]]*[^\s<>"')\].,;:!?])/g);
  const linkClass = "font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400";
  return (
    <>
      {parts.map((part, i) =>
        /^\/p\/[0-9a-f-]{36}$/.test(part) ? (
          <Link key={i} href={part} className={linkClass}>
            {label}
          </Link>
        ) : /^\/send\?t=/.test(part) ? (
          <Link key={i} href={part} className={linkClass} data-testid="send-link">
            💸 {t("Review and send")}
          </Link>
        ) : /^https:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {part}
          </a>
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
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
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
      .catch(() => setError(t("Could not open the agent.")));
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
      // "this page" means the one behind the panel — the agent reads it with the asker's rights
      body: JSON.stringify({ text: text.trim(), contextPageId: pageIdOf(pathname) ?? undefined }),
    }).catch(() => null);
    const d = (await r?.json().catch(() => null)) as { message?: { id: string } } | null;
    if (!r?.ok || !d?.message) {
      setAsked(null);
      setError(t("Could not send."));
    } else setAsked(d.message.id);
    void load(a.roomId);
  }

  // a chat screen has its own composer and its own agent: the round button would
  // be a second agent there (and on a phone it sits on top of the send button)
  const onChatScreen = /^\/(dm|chat)\//.test(pathname || "");
  const offer = suggestionsFor({ pageId: pageIdOf(pathname), hasDrives: (a?.drives.length ?? 0) > 0, hasHistory: msgs.length > 0 });
  if (!open)
    return (
      <button
        data-testid="assistant-dock-button"
        onClick={() => setOpen(true)}
        title={t("Agent")}
        aria-label={t("Open agent")}
        className={`fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition-transform hover:scale-105 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:right-4 dark:bg-neutral-100 dark:text-neutral-900 ${onChatScreen ? "hidden" : ""}`}
      >
        <Sparkles size={20} />
      </button>
    );

  return (
    <aside
      data-testid="assistant-panel"
      aria-label={t("Agent")}
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-neutral-200 bg-white max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full max-md:border-l-0 max-md:pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-[#1f1f1f]"
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
          <Sparkles size={14} />
        </span>
        <span className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{a?.agentName ?? t("Agent")}</span>
        <button onClick={() => setOpen(false)} aria-label={t("Close")} className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-100 max-md:flex max-md:h-9 max-md:w-9 max-md:items-center max-md:justify-center dark:hover:bg-neutral-800">
          <X size={16} />
        </button>
      </div>
      {a && (
        <div data-testid="assistant-drives" className="border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
          <div className="mb-1 flex items-center">
            <p className="text-[11px] font-medium text-neutral-400">{t("{n} linked aindrive folders", { n: a.drives.length })}</p>
            {a.teamspaceId && (
              <AinuiButton testId="assistant-family" label={t("Family folders · Invite")} onClick={() => openFamilySheet(a.teamspaceId!)} />
            )}
          </div>
          {a.drives.length === 0 && (
            <div data-testid="assistant-no-drives" className="space-y-2 pb-1 text-xs text-neutral-500">
              <p>
                {t("No aindrive folders are shared in {ws} yet. Connect your aindrive, or share folders into a teamspace, and the agent reads them here.", {
                  ws: a.workspaceName ?? t("this workspace"),
                })}
              </p>
              {aindrive?.configured && !aindrive.connected ? (
                <AindriveConnect compact onConnected={() => setA(null)} />
              ) : (
                <AinuiButton label={t("Share aindrive folders")} onClick={() => router.push(`/aindrive/share?next=${encodeURIComponent(pathname || "/")}`)} />
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {[...a.drives].sort((x, y) => Number(y.online) - Number(x.online)).slice(0, CHIPS).map((d) => (
              <AinuiText key={d.label} text={`${d.owner ? `${d.owner} · ` : ""}${d.label} · ${d.online ? t("Connected") : t("Offline")}`} />
            ))}
            {a.drives.length > CHIPS && (
              <span className="px-1 py-0.5 text-[11px] text-neutral-400">{t("+{n} more", { n: a.drives.length - CHIPS })}</span>
            )}
          </div>
        </div>
      )}
      <div ref={listRef} data-testid="assistant-messages" className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {a && offer.list.length > 0 && (
          <div className="space-y-2">
            {a.drives.length > 0 && <p className="text-sm text-neutral-500">{t("I can see your family's aindrive folders. What can I do?")}</p>}
            {offer.list.map((key) => t(key)).map((s) => (
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
          // a card line ("Is this Minjun?", the Send button) is drawn as that card, like the room chat does
          return splitA2uiMarkers(m.text).map((part, pi) =>
            part.kind === "text" ? (
              <div key={`${m.id}-${pi}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    mine ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                  }`}
                >
                  <Linked text={part.text} label={t("Open page")} />
                </div>
              </div>
            ) : part.kind === "send" ? (
              <div key={`${m.id}-${pi}`} className="flex justify-start">
                <A2uiSurface src={sendOfferSrc(part.view, part.offerId)} refreshKey={msgs.length} />
              </div>
            ) : null
          );
        })}
        {waiting && <p className="text-xs text-neutral-400">{t("Looking through the family's folders…")}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      {a && <SuggestionChips items={offer.chips.map((key) => t(key))} onPick={(s) => void send(s)} disabled={asked === "sending"} />}
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
          placeholder={t("Ask the agent for something…")}
          className="flex-1 rounded-full border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700"
        />
        <button
          type="submit"
          data-testid="assistant-send"
          disabled={!draft.trim() || !a}
          aria-label={t("Send")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
