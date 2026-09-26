"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { useT } from "@/i18n/provider";
import type { T } from "@/i18n/translate";
import type { TreasuryStatus } from "@/lib/agent/treasury/types";
import { SKIP_REASON_TEXT, relationDay } from "@/lib/agent/treasury/recurring-record";
import type { RecurringRunResult } from "@/lib/agent/treasury/recurring";
import { recurringBuySurfaceId } from "@/lib/agent/treasurer/surfaces";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";

type Tone = "ok" | "bad" | "info";
type Recurring = NonNullable<TreasuryStatus["recurring"]>;
type Live = NonNullable<Recurring["live"]>;
type Pending = NonNullable<Recurring["pending"]>;
type Approval = TreasuryStatus["actions"][number]["approvals"][number];
/** One line after something was asked of the server; `href` is its transaction. */
type Note = { tone: Tone; text: string; href?: string };

const NOTE_TONE: Record<Tone, string> = {
  ok: "text-emerald-700 dark:text-emerald-300",
  bad: "text-red-700 dark:text-red-300",
  info: "text-neutral-500 dark:text-neutral-400",
};
const CHIP = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900",
  off: "bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-900";
const PRIMARY = `inline-flex h-7 items-center gap-1 rounded-md bg-neutral-900 px-2.5 text-xs font-semibold text-white transition hover:bg-neutral-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white ${FOCUS}`;
const QUIET = `rounded px-1 text-xs text-neutral-500 transition-colors hover:text-red-700 active:text-red-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-neutral-400 dark:hover:text-red-300 ${FOCUS}`;
const LINK = `font-mono underline decoration-dotted underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200 ${FOCUS}`;

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}
/** Whole-token decimal strings ("0.0000254") to at most 6 significant digits. */
function tokens(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n) : amount;
}
/** An explorer link's last path segment is the transaction hash. */
function txOf(url: string): string {
  const hash = url.split("/").pop() ?? url;
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}
/** Approval times are shown where the group is, as the panel's payment cards do: the trip is in Tokyo. */
const tokyoClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : tokyoClock.format(d);
}
function hoursLeft(iso: string, t: T): string {
  const h = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (h <= 0) return t("expiring");
  return h < 1
    ? t("expires in {n} min", { n: Math.max(1, Math.round(h * 60)) })
    : t("expires in {n} h", { n: Math.round(h) });
}
/** "$20 a week · 12 weeks" — the same words as the proposal's card in the chat. */
function termsLine(r: { weeklyUsd: number; weeks: number }, t: T): string {
  return r.weeks === 1
    ? t("{amount} a week · 1 week", { amount: usd(r.weeklyUsd) })
    : t("{amount} a week · {n} weeks", { amount: usd(r.weeklyUsd), n: r.weeks });
}

function runNote(r: RecurringRunResult, t: T): Note {
  switch (r.outcome) {
    case "bought":
      return { tone: "ok", text: t("Bought {weth} WETH for {usdc} USDC", { weth: tokens(r.wethOut), usdc: tokens(r.usdcIn) }), href: r.txUrl };
    case "skipped":
      return { tone: "info", text: t("Skipped: {reason}", { reason: t(SKIP_REASON_TEXT[r.reason]) }) };
    case "rehearsal":
      return { tone: "info", text: t("Rehearsal — would buy {amount} of ETH. Nothing moved.", { amount: usd(r.wouldBuyUsd) }) };
    case "none":
      return { tone: "info", text: t("No recurring buy is running.") };
  }
}

/**
 * The room's recurring buy inside the treasury panel, as one compact block:
 * the proposal's card in the chat carries its full terms and the Approve
 * button, the Treasury page its history. States: waiting for World ID
 * approvals (slots with names and Tokyo times) → adopting → running → bought
 * this week → stopped. Numbers and permissions come from the server
 * (status.recurring, status.actions, the recurring route); the buttons only
 * ask. Mount it keyed by roomId.
 */
export function RecurringBuyPanel({
  roomId,
  status,
  onChanged,
}: {
  roomId: string;
  status: TreasuryStatus;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState<"run" | "stop" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  // a stop ends the block for everyone; the one who stopped it keeps a closing line until they dismiss it
  const [ended, setEnded] = useState<{ actionId: string; terms: string; text: string } | null>(null);

  const recurring = status.recurring;
  const live = recurring?.live ?? null;
  const pending = recurring?.pending ?? null;
  // another request or authority replaces the closing line (set during render, as React allows for derived state)
  const shownId = live?.actionId ?? pending?.actionId ?? null;
  if (ended && shownId && shownId !== ended.actionId) setEnded(null);

  async function send(action: "run" | "stop", actionId: string, terms: string) {
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch(`/api/dm/rooms/${roomId}/treasury/recurring`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; result?: RecurringRunResult };
      if (!res.ok) setNote({ tone: "bad", text: data.error || t("That didn't work ({status}).", { status: res.status }) });
      else if (action === "run" && data.result) setNote(runNote(data.result, t));
      // with an authority in force a stop hits that one; otherwise it cancelled the waiting request
      else if (action === "stop") setEnded({ actionId, terms, text: live ? t("Stopped. No more buys.") : t("Cancelled. It won't run.") });
      await onChanged();
    } catch {
      setNote({ tone: "bad", text: t("Couldn't reach the server — nothing changed.") });
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  }

  const stopControl = (actionId: string, terms: string) =>
    confirmStop ? (
      <span data-testid="treasury-recurring-stop-confirm" className="flex items-center gap-2 text-xs">
        <span className="text-neutral-600 dark:text-neutral-400">{live ? t("Stop it for good?") : t("Cancel it?")}</span>
        <button
          type="button"
          data-testid="treasury-recurring-stop-yes"
          onClick={() => void send("stop", actionId, terms)}
          disabled={busy !== null}
          className={`rounded px-1 font-medium text-red-700 transition-colors hover:text-red-600 disabled:opacity-50 dark:text-red-300 ${FOCUS}`}
        >
          {busy === "stop" ? t("Stopping…") : live ? t("Yes, stop") : t("Yes, cancel")}
        </button>
        <button
          type="button"
          onClick={() => setConfirmStop(false)}
          disabled={busy !== null}
          className={`rounded px-1 text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 ${FOCUS}`}
        >
          {t("Keep it")}
        </button>
      </span>
    ) : (
      <button
        type="button"
        data-testid="treasury-recurring-stop"
        onClick={() => {
          setNote(null);
          setConfirmStop(true);
        }}
        disabled={busy !== null}
        className={QUIET}
      >
        {live ? t("Stop") : t("Cancel request")}
      </button>
    );

  if (!shownId) {
    if (!ended) return null;
    return (
      <Block
        state="stopped"
        terms={ended.terms}
        chip={<Chip tone="off">{t("Stopped")}</Chip>}
        actions={<span className="text-xs text-neutral-600 dark:text-neutral-300">{ended.text}</span>}
        side={
          <button
            type="button"
            onClick={() => setEnded(null)}
            className={`rounded px-1 text-xs text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 ${FOCUS}`}
          >
            {t("Dismiss")}
          </button>
        }
      />
    );
  }

  return (
    <>
      {/* what needs a vote comes first; with an authority in force a stop hits that one, so the request offers none */}
      {pending && (
        <PendingBlock
          roomId={roomId}
          status={status}
          pending={pending}
          stopControl={live ? null : stopControl(pending.actionId, termsLine(pending, t))}
          note={live ? null : note}
        />
      )}
      {live && (
        <LiveBlock
          live={live}
          history={recurring?.history ?? []}
          realRuns={recurring?.realRuns ?? false}
          busy={busy}
          onRun={() => void send("run", live.actionId, termsLine(live, t))}
          stopControl={stopControl(live.actionId, termsLine(live, t))}
          note={note}
        />
      )}
    </>
  );
}

function Chip({ tone, children }: { tone: keyof typeof CHIP; children: ReactNode }) {
  return (
    <span data-testid="treasury-recurring-state" className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium ring-1 ${CHIP[tone]}`}>
      {children}
    </span>
  );
}

/** The swap it makes, in the shared vocabulary: the pair, then where — Uniswap v3 on Base. */
function Route() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
      <span className="mr-0.5">USDC → WETH</span>
      <UniswapBadge />
      <ChainBadge chain="base" />
    </span>
  );
}

/**
 * Two fixed rows: what it is and where it stands, then what can be done —
 * a result or a confirmation replaces part of the second row, never adds one.
 * The swap's route shows once it runs; a request's is on its card in the chat.
 */
function Block({
  state,
  terms,
  chip,
  route,
  actions,
  side,
}: {
  state: string;
  terms: string;
  chip: ReactNode;
  route?: boolean;
  actions: ReactNode;
  side?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      data-testid={`treasury-recurring-${state}`}
      data-state={state}
      className="mt-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-700"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 text-sm font-medium text-neutral-900 dark:text-neutral-100">🔁 {t("Recurring buy")}</span>
        <span className="shrink-0 text-sm tabular-nums text-neutral-700 dark:text-neutral-300">{terms}</span>
        {chip}
        {route && (
          <span className="ml-auto">
            <Route />
          </span>
        )}
      </div>
      <div className="mt-1.5 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        {actions}
        {side && <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">{side}</span>}
      </div>
    </div>
  );
}

/** The result of the last thing asked, in the row's quiet corner. */
function NoteText({ note }: { note: Note }) {
  const t = useT();
  return (
    <span role="status" data-testid="treasury-recurring-result" title={note.text} className={`min-w-0 truncate ${NOTE_TONE[note.tone]}`}>
      {note.text}
      {note.href && (
        <>
          {" · "}
          <a href={note.href} target="_blank" rel="noreferrer" title={t("Open on Basescan")} className={LINK}>
            {txOf(note.href)}
          </a>
        </>
      )}
    </span>
  );
}

/** Mini approval slots: a filled one per approval (name · Tokyo time), then who can still approve, dashed and by name. */
function Slots({
  approvals,
  required,
  waitingOn,
}: {
  approvals: Pick<Approval, "userId" | "displayName" | "at">[];
  required: number;
  /** voters who haven't approved yet, in the room's order */
  waitingOn: string[];
}) {
  const t = useT();
  const got = Math.min(approvals.length, required);
  const progress = t("{n} of {m} verified humans", { n: got, m: required });
  return (
    <span
      data-testid="treasury-recurring-slots"
      className="flex flex-wrap items-center gap-1"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={required}
      aria-valuenow={got}
      aria-valuetext={`${progress}${approvals.length ? `: ${approvals.map((p) => `${p.displayName} ${clock(p.at)}`).join(", ")}` : ""}`}
      title={progress}
    >
      {Array.from({ length: Math.max(required, approvals.length) }, (_, i) => {
        const p = approvals[i];
        return p ? (
          <span
            key={p.userId}
            data-testid="treasury-slot-filled"
            title={t("{name} approved with a fresh World ID check at {time} (Tokyo)", { name: p.displayName, time: clock(p.at) })}
            className="inline-flex h-5 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
          >
            ✓ {p.displayName}
            <span className="tabular-nums opacity-75">{clock(p.at)}</span>
          </span>
        ) : (
          <span
            key={`open-${i}`}
            data-testid="treasury-slot-empty"
            aria-hidden
            className="inline-flex h-5 min-w-8 items-center justify-center rounded border border-dashed border-neutral-300 px-1.5 text-[11px] text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
          >
            {waitingOn[i - approvals.length] ?? "–"}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Scrolls the conversation to the proposal's card, where it is approved, and
 * marks it; when the card isn't on screen (an older proposal), the Treasury
 * page shows the request instead.
 */
function useShowCard(roomId: string, actionId: string): () => void {
  const router = useRouter();
  return () => {
    const cards = document.querySelectorAll<HTMLElement>(`[data-surface-id="${recurringBuySurfaceId(actionId)}"]`);
    const card = cards[cards.length - 1];
    if (!card) {
      router.push(`/treasury/${roomId}`);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    card.animate(
      [{ boxShadow: "0 0 0 0 rgba(35,131,226,0)" }, { boxShadow: "0 0 0 3px rgba(35,131,226,0.45)" }, { boxShadow: "0 0 0 0 rgba(35,131,226,0)" }],
      { duration: 1400, easing: "ease-out" }
    );
  };
}

/** A recurring buy waiting for approvals, then adopting once the last one lands. */
function PendingBlock({
  roomId,
  status,
  pending,
  stopControl,
  note,
}: {
  roomId: string;
  status: TreasuryStatus;
  pending: Pending;
  stopControl: ReactNode | null;
  note: Note | null;
}) {
  const t = useT();
  const showCard = useShowCard(roomId, pending.actionId);
  // the action row carries who approved and when, and the viewer's canApprove; status.recurring the terms
  const action = status.actions.find((a) => a.id === pending.actionId);
  const approvals = action?.approvals ?? [];
  const got = Math.max(pending.approvals, approvals.length);
  const adopting = got >= pending.required;
  const iApproved = Boolean(status.viewerId && approvals.some((p) => p.userId === status.viewerId));
  const me = status.members.find((m) => m.userId === status.viewerId);
  const left = pending.required - got;

  let doNow: ReactNode;
  if (adopting)
    doNow = (
      <span data-testid="treasury-recurring-adopting" className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
        {t("Adopting…")}
      </span>
    );
  else if (action?.canApprove && status.idpMode)
    // approving happens on the proposal's card, where its full terms are
    doNow = (
      <button type="button" data-testid="treasury-recurring-review" onClick={showCard} className={PRIMARY}>
        {t("Review and approve")}
        <ArrowDown aria-hidden className="h-3.5 w-3.5" />
      </button>
    );
  else
    doNow = (
      <span className="text-xs text-neutral-600 dark:text-neutral-300">
        {iApproved
          ? left === 1
            ? t("✓ You approved — waiting for 1 more.")
            : t("✓ You approved — waiting for {n} more.", { n: left })
          : !status.mySeated
            ? t("No vote yet — claim it above.")
            : me && !me.voting
              ? t("You joined after the rules were adopted — no vote yet.")
              : !status.idpMode
                ? t("World ID for Agents is not configured")
                : t("Waiting for other verified humans.")}
      </span>
    );

  return (
    <Block
      state={adopting ? "adopting" : "waiting"}
      terms={termsLine(pending, t)}
      chip={
        <Slots
          approvals={approvals}
          required={pending.required}
          waitingOn={status.members
            .filter((m) => m.seated && m.voting && !approvals.some((p) => p.userId === m.userId))
            .map((m) => m.displayName)}
        />
      }
      actions={
        <>
          {doNow}
          {!adopting && stopControl}
        </>
      }
      side={note ? <NoteText note={note} /> : adopting ? null : <span className="tabular-nums">{hoursLeft(pending.expiresAt, t)}</span>}
    />
  );
}

/** The adopted authority: where this week stands, and the two things anyone may ask of it. */
function LiveBlock({
  live,
  history,
  realRuns,
  busy,
  onRun,
  stopControl,
  note,
}: {
  live: Live;
  history: Recurring["history"];
  realRuns: boolean;
  busy: "run" | "stop" | null;
  onRun: () => void;
  stopControl: ReactNode;
  note: Note | null;
}) {
  const t = useT();
  const bought = live.thisWeek === "bought";
  const receipt = bought ? history.find((h) => h.outcome === "bought") : undefined;
  return (
    <Block
      state={bought ? "bought" : "running"}
      terms={termsLine(live, t)}
      chip={
        bought ? (
          <Chip tone="ok">{t("✓ Bought this week")}</Chip>
        ) : (
          <Chip tone="ok">{t("Week {k} of {n}", { k: live.weekIndex, n: live.weeks })}</Chip>
        )
      }
      route
      actions={
        <>
          {bought ? (
            // this week is done: its receipt, instead of a button that can't be pressed
            <span data-testid="treasury-recurring-receipt" className="text-xs text-neutral-600 dark:text-neutral-300">
              {receipt
                ? t("{weth} WETH for {usdc} USDC", { weth: tokens(receipt.wethOut ?? "0"), usdc: tokens(receipt.usdcIn ?? "0") })
                : t("Bought {n} of {m} weeks", { n: live.boughtWeeks, m: live.weeks })}
              {receipt?.txUrl && (
                <>
                  {" · "}
                  <a href={receipt.txUrl} target="_blank" rel="noreferrer" title={t("Open on Basescan")} className={LINK}>
                    {txOf(receipt.txUrl)}
                  </a>
                </>
              )}
            </span>
          ) : (
            <button type="button" data-testid="treasury-recurring-run" onClick={onRun} disabled={busy !== null} className={PRIMARY}>
              {busy === "run" ? (realRuns ? t("Buying on Base…") : t("Rehearsing…")) : t("Buy this week's ETH")}
              {!realRuns && busy !== "run" && <span className="font-normal opacity-70">{t("(rehearsal)")}</span>}
            </button>
          )}
          {stopControl}
        </>
      }
      side={
        note ? (
          <NoteText note={note} />
        ) : bought && live.nextRunAt ? (
          <span data-testid="treasury-recurring-next">{t("Next buy {day}", { day: relationDay(live.nextRunAt) })}</span>
        ) : null
      }
    />
  );
}
