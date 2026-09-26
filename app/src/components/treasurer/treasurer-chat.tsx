"use client";

/**
 * "Your treasurer" — a member's conversation with the room's agent acting as
 * Treasurer, over the AG-UI stream of /api/treasury/[roomId]/ask. The answer
 * streams in as text, each tool the agent uses shows as a quiet one-line
 * step, and the cards it shows (A2UI surfaces) are drawn inline.
 *
 * "Only me" keeps the exchange in the member's quiet side-channel with the
 * agent (it reopens from there on mount, and shows in the room chat to them
 * alone); "Post to room" asks and answers in the room for everyone.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, Loader2, Lock, Minus, Send, Users } from "lucide-react";
import { useT } from "@/i18n/provider";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { A2UI_SURFACE_EVENT, readAgUiStream, type AgUiEvent } from "@/lib/agui/events";
import type { A2uiMessage } from "@/lib/x402/a2ui";
import { splitA2uiMarkers } from "@/lib/agent/treasurer/surfaces";
import { A2uiSurface } from "@/components/a2ui/surface";

type Mode = "private" | "room";

type Item =
  | { kind: "user"; id: string; text: string; mode: Mode }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; state: "running" | "done" | "refused" }
  | { kind: "surface"; id: string; messages?: A2uiMessage[]; src?: string }
  | { kind: "error"; id: string; text: string };

interface HistoryTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/** What each tool did, as the step row says it (English source keys). */
const TOOL_LABEL: Record<string, string> = {
  get_treasury_status: "Read the treasury",
  get_recurring_buy: "Checked the recurring buy",
  list_activity: "Looked through the activity",
  explain_rules: "Read our rules",
  propose_recurring_buy: "Queued a recurring buy for approval",
  stop_recurring_buy: "Stopped the recurring buy",
  buy_this_week: "Ran this week's buy",
};

let seq = 0;
const localId = (p: string) => `${p}-${++seq}`;

function surfaceSrc(roomId: string, actionId: string): string {
  return `/api/treasury/${encodeURIComponent(roomId)}/surfaces/recurring-buy/${encodeURIComponent(actionId)}`;
}

function historyItems(roomId: string, turns: HistoryTurn[]): Item[] {
  return turns.flatMap((turn): Item[] =>
    turn.role === "user"
      ? [{ kind: "user", id: turn.id, text: turn.text, mode: "private" }]
      : splitA2uiMarkers(turn.text).map((p, i): Item =>
          p.kind === "text"
            ? { kind: "assistant", id: `${turn.id}-${i}`, text: p.text }
            : { kind: "surface", id: `${turn.id}-${i}`, src: surfaceSrc(roomId, p.actionId) }
        )
  );
}

export function TreasurerChat({ roomId }: { roomId: string }) {
  const t = useT();
  const { imeProps, composing } = useImeGuard();
  const [items, setItems] = useState<Item[]>([]);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("private");
  const [running, setRunning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/treasury/${encodeURIComponent(roomId)}/ask`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { agent?: { name?: string }; messages?: HistoryTurn[] } | null) => {
        if (!live || !data) return;
        setAgentName(data.agent?.name ?? null);
        setItems(historyItems(roomId, data.messages ?? []));
      })
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [roomId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [items]);

  const onEvent = useCallback((e: AgUiEvent) => {
    setItems((prev) => {
      switch (e.type) {
        case "TEXT_MESSAGE_START":
          return [...prev, { kind: "assistant", id: e.messageId, text: "" }];
        case "TEXT_MESSAGE_CONTENT":
          return prev.map((it) => (it.kind === "assistant" && it.id === e.messageId ? { ...it, text: it.text + e.delta } : it));
        case "TOOL_CALL_START":
          return [...prev, { kind: "tool", id: e.toolCallId, name: e.toolCallName, state: "running" }];
        case "TOOL_CALL_RESULT": {
          let refused = false;
          try {
            refused = (JSON.parse(e.content) as { ok?: unknown }).ok === false;
          } catch {
            // an unreadable result still finished
          }
          return prev.map((it) =>
            it.kind === "tool" && it.id === e.toolCallId ? { ...it, state: refused ? "refused" : "done" } : it
          );
        }
        case "CUSTOM": {
          if (e.name !== A2UI_SURFACE_EVENT) return prev;
          const v = e.value as { messages?: A2uiMessage[] } | null;
          return Array.isArray(v?.messages) ? [...prev, { kind: "surface", id: localId("surface"), messages: v.messages }] : prev;
        }
        case "RUN_ERROR":
          return [...prev, { kind: "error", id: localId("error"), text: e.message }];
        default:
          return prev;
      }
    });
  }, []);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || running) return;
    setDraft("");
    setRunning(true);
    setItems((prev) => [...prev, { kind: "user", id: localId("user"), text: message, mode }]);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const res = await fetch(`/api/treasury/${encodeURIComponent(roomId)}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message, mode }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setItems((prev) => [
          ...prev,
          { kind: "error", id: localId("error"), text: data.error ?? t("The treasurer couldn't answer just now.") },
        ]);
        return;
      }
      await readAgUiStream(res.body, onEvent);
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setItems((prev) => [...prev, { kind: "error", id: localId("error"), text: t("The connection dropped — try again.") }]);
    } finally {
      setRunning(false);
      // a finished step still marked running means the stream ended under it
      setItems((prev) => prev.map((it) => (it.kind === "tool" && it.state === "running" ? { ...it, state: "refused" } : it)));
    }
  }, [draft, mode, onEvent, roomId, running, t]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composing(e)) {
      e.preventDefault();
      void send();
    }
  };

  const waiting = running && !items.some((it, i) => i === items.length - 1 && it.kind === "assistant");

  return (
    <section
      data-testid="treasurer-chat"
      className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-3xl bg-white text-[#191F28] ring-1 ring-black/5 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{t("Your treasurer")}</h2>
          {agentName && <p className="truncate text-xs text-[#6B7684] dark:text-neutral-400">{agentName}</p>}
        </div>
        <div
          role="radiogroup"
          aria-label={t("Who sees this conversation")}
          className="flex shrink-0 rounded-full bg-[#F4F5F7] p-0.5 text-xs font-medium dark:bg-neutral-800"
        >
          {(
            [
              ["private", t("Only me"), Lock],
              ["room", t("Post to room"), Users],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              data-testid={`treasurer-mode-${value}`}
              onClick={() => setMode(value)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors ${
                mode === value
                  ? "bg-white text-[#191F28] shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-[#6B7684] hover:text-[#191F28] dark:text-neutral-400 dark:hover:text-neutral-100"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto px-5 pb-3">
        {loaded && items.length === 0 && (
          <p className="py-8 text-center text-sm text-[#6B7684] dark:text-neutral-400">
            {t("Ask about the balance, the rules, or set up a recurring ETH buy.")}
          </p>
        )}
        {items.map((it) => {
          switch (it.kind) {
            case "user":
              return (
                <div key={it.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#3182F6] px-3.5 py-2 text-sm text-white [overflow-wrap:anywhere]">
                    {it.text}
                  </p>
                </div>
              );
            case "assistant":
              return it.text ? (
                <p
                  key={it.id}
                  data-testid="treasurer-answer"
                  className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-[#F4F5F7] px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] dark:bg-neutral-800"
                >
                  {it.text}
                </p>
              ) : null;
            case "tool":
              return (
                <p
                  key={it.id}
                  data-testid="treasurer-step"
                  className="flex items-center gap-1.5 pl-1 text-xs text-[#6B7684] dark:text-neutral-400"
                >
                  {it.state === "running" ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : it.state === "done" ? (
                    <Check size={12} className="text-[#00A86B]" />
                  ) : (
                    <Minus size={12} />
                  )}
                  {t(TOOL_LABEL[it.name] ?? "Used a tool")}
                </p>
              );
            case "surface":
              return (
                <div key={it.id}>
                  <A2uiSurface messages={it.messages} src={it.src} />
                </div>
              );
            case "error":
              return (
                <p key={it.id} className="pl-1 text-xs text-[#F04452]">
                  {it.text}
                </p>
              );
          }
        })}
        {waiting && (
          <p className="flex items-center gap-1.5 pl-1 text-xs text-[#6B7684] dark:text-neutral-400">
            <Loader2 size={12} className="animate-spin" />
            {t("Thinking…")}
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/10">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          {...imeProps}
          rows={1}
          maxLength={2000}
          placeholder={t("Ask your treasurer…")}
          data-testid="treasurer-input"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-2xl bg-[#F4F5F7] px-3.5 py-2 text-sm outline-none placeholder:text-[#6B7684] focus:ring-2 focus:ring-[#3182F6]/40 dark:bg-neutral-800"
        />
        <button
          type="submit"
          disabled={running || !draft.trim()}
          aria-label={t("Send")}
          data-testid="treasurer-send"
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#3182F6] text-white transition-opacity disabled:opacity-40"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </section>
  );
}
