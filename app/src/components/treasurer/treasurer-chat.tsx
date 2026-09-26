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
import { sendOfferSrc } from "@/lib/agent/send-offer-surface";
import { A2uiSurface } from "@/components/a2ui/surface";

type Mode = "private" | "room";

type Item =
  | { kind: "user"; id: string; text: string; mode: Mode }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; state: "running" | "done" | "refused"; label: string }
  /** `run`: the answer that streamed it (history cards have none) — one card per recurring buy per answer; `rev` counts redraws */
  | { kind: "surface"; id: string; messages?: A2uiMessage[]; src?: string; actionId?: string; run?: number; rev?: number }
  | { kind: "error"; id: string; text: string };

interface HistoryTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/** Each tool's step row while it runs, once it did, and when it did nothing (English source keys). */
const STEP: Record<string, { running: string; done: string; refused?: string }> = {
  get_treasury_status: { running: "Reading the treasury…", done: "Read the treasury" },
  get_recurring_buy: { running: "Checking the recurring buy…", done: "Checked the recurring buy" },
  list_activity: { running: "Looking through the activity…", done: "Looked through the activity" },
  explain_rules: { running: "Reading our rules…", done: "Read our rules" },
  propose_recurring_buy: { running: "Queuing a recurring buy…", done: "Queued a recurring buy for approval", refused: "Nothing was queued" },
  stop_recurring_buy: { running: "Stopping the recurring buy…", done: "Stopped the recurring buy", refused: "Nothing was stopped" },
  buy_this_week: { running: "Running this week's buy…", done: "Ran this week's buy", refused: "Nothing was bought" },
};
const STEP_FALLBACK = { running: "Working…", done: "Used a tool", refused: "Couldn't finish that step" };

/** The step row's label for a finished call, from what its result says happened. */
function stepLabel(name: string, result: Record<string, unknown> | null): string {
  const step = STEP[name] ?? STEP_FALLBACK;
  if (!result || result.ok === false) return step.refused ?? STEP_FALLBACK.refused;
  if (name === "buy_this_week" && result.outcome === "rehearsal") return "Rehearsed this week's buy";
  if (name === "buy_this_week" && result.outcome === "skipped") return "Skipped this week's buy";
  if (name === "buy_this_week" && result.outcome === "bought") return "Bought this week's ETH";
  if (name === "stop_recurring_buy" && result.what === "cancelled") return "Cancelled the request";
  return step.done;
}

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
            : { kind: "surface", id: `${turn.id}-${i}`, src: p.kind === "send" ? sendOfferSrc(p.view, p.offerId) : surfaceSrc(roomId, p.actionId) }
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
  const content = useRef<HTMLDivElement>(null);
  /** the view follows the latest message until the member scrolls up to read */
  const pinned = useRef(true);
  const abort = useRef<AbortController | null>(null);
  /** which answer is streaming, so a card drawn twice in it is redrawn in place */
  const run = useRef(0);

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

  // cards arrive after the text around them (a fetched card grows from its placeholder), so the
  // view follows the content's height, not just the list of items
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const follow = new ResizeObserver(() => {
      if (pinned.current) el.scrollTo({ top: el.scrollHeight });
    });
    follow.observe(inner);
    return () => follow.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };

  const onEvent = useCallback(
    (e: AgUiEvent) => {
      const thisRun = run.current;
      setItems((prev) => {
        switch (e.type) {
          case "TEXT_MESSAGE_START":
            return [...prev, { kind: "assistant", id: e.messageId, text: "" }];
          case "TEXT_MESSAGE_CONTENT":
            return prev.map((it) => (it.kind === "assistant" && it.id === e.messageId ? { ...it, text: it.text + e.delta } : it));
          case "TOOL_CALL_START":
            return [
              ...prev,
              { kind: "tool", id: e.toolCallId, name: e.toolCallName, state: "running", label: (STEP[e.toolCallName] ?? STEP_FALLBACK).running },
            ];
          case "TOOL_CALL_RESULT": {
            let result: Record<string, unknown> | null = null;
            try {
              result = JSON.parse(e.content) as Record<string, unknown>;
            } catch {
              // an unreadable result still finished; it reads as nothing done
            }
            const refused = !result || result.ok === false;
            return prev.map((it) =>
              it.kind === "tool" && it.id === e.toolCallId
                ? { ...it, state: refused ? "refused" : "done", label: stepLabel(it.name, result) }
                : it
            );
          }
          case "CUSTOM": {
            if (e.name !== A2UI_SURFACE_EVENT) return prev;
            const v = e.value as { messages?: A2uiMessage[]; actionId?: unknown } | null;
            if (!Array.isArray(v?.messages)) return prev;
            const actionId = typeof v.actionId === "string" ? v.actionId : undefined;
            // src too, so the card refetches on focus like the room chat's: approvals given elsewhere show up
            const card = { messages: v.messages, src: actionId ? surfaceSrc(roomId, actionId) : undefined };
            const at = actionId
              ? prev.findIndex((it) => it.kind === "surface" && it.run === thisRun && it.actionId === actionId)
              : -1;
            if (at >= 0) return prev.map((it, i) => (i === at && it.kind === "surface" ? { ...it, ...card, rev: (it.rev ?? 0) + 1 } : it));
            return [...prev, { kind: "surface", id: localId("surface"), actionId, run: thisRun, ...card }];
          }
          case "RUN_ERROR":
            return [...prev, { kind: "error", id: localId("error"), text: e.message }];
          default:
            return prev;
        }
      });
    },
    [roomId]
  );

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || running) return;
    setDraft("");
    setRunning(true);
    run.current += 1;
    pinned.current = true;
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
      // a step still marked running means the stream ended under it — the server may still have
      // done it, so it never reads "Nothing was queued" (the run's error says to check the treasury)
      setItems((prev) =>
        prev.map((it) => (it.kind === "tool" && it.state === "running" ? { ...it, state: "refused", label: STEP_FALLBACK.refused } : it))
      );
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

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-5 pb-3">
        <div ref={content} className="space-y-2.5">
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
                    {t(it.label)}
                  </p>
                );
              case "surface":
                return (
                  <div key={it.id}>
                    {/* a card redrawn in place remounts, so it can't keep the copy it fetched before */}
                    <A2uiSurface key={it.rev ?? 0} messages={it.messages} src={it.src} />
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
