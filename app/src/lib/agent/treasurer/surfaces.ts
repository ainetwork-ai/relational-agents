/**
 * The recurring buy as an A2UI v0.9 surface — the one card the treasurer's
 * stream, the room chat and the Treasury page all draw
 * (components/a2ui/surface.tsx). One surface per recurring-buy action, showing
 * that action as it stands now: waiting for approvals, running, or over.
 *
 * Short on purpose: the weekly amount, its weeks and total, what each buy
 * really swaps (the story's dollars are demo scale), the approvals as slots,
 * and one action — the thing this viewer can do now: approve (the World ID
 * approval page for that action) while it waits, else stop or cancel (POST
 * to the surface route, which answers with the surface redrawn). The rule,
 * the wallet and the terms' fingerprint are on the approval page itself.
 *
 * Also the room-chat marker: an agent message carrying a line
 * `[[a2ui:recurring-buy/<actionId>]]` shows that card in place of the line.
 *
 * Pure: no IO, safe on the client. Text is English source run through the
 * caller's `t`.
 */

import type { T } from "@/i18n";
import { A2UI_BASIC_CATALOG, A2UI_VERSION, type A2uiComponent, type A2uiMessage } from "@/lib/x402/a2ui";
import { relationDay } from "@/lib/agent/treasury/recurring-record";

export const TREASURY_APPROVE_ACTION = "ainmem.treasury.approve";
export const TREASURY_STOP_ACTION = "ainmem.treasury.stop";
export const TREASURY_OPEN_ACTION = "ainmem.treasury.open";

// ── the room-chat marker ────────────────────────────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MARKER_LINE = new RegExp(`^\\s*\\[\\[a2ui:recurring-buy/(${UUID})\\]\\]\\s*$`, "i");

export function recurringBuyMarker(actionId: string): string {
  return `[[a2ui:recurring-buy/${actionId}]]`;
}

/** A message's text as parts: plain text runs and the recurring-buy cards its marker lines name, in order. */
export function splitA2uiMarkers(text: string): ({ kind: "text"; text: string } | { kind: "recurring-buy"; actionId: string })[] {
  if (!text.includes("[[a2ui:")) return [{ kind: "text", text }];
  const parts: ({ kind: "text"; text: string } | { kind: "recurring-buy"; actionId: string })[] = [];
  let run: string[] = [];
  const flush = () => {
    const joined = run.join("\n").replace(/^\n+|\n+$/g, "");
    if (joined) parts.push({ kind: "text", text: joined });
    run = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(MARKER_LINE);
    if (m) {
      flush();
      parts.push({ kind: "recurring-buy", actionId: m[1].toLowerCase() });
    } else run.push(line);
  }
  flush();
  return parts;
}

/** The text without its marker lines — what a model reads back as history. */
export function stripA2uiMarkers(text: string): string {
  return splitA2uiMarkers(text)
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n");
}

export function recurringBuySurfaceId(actionId: string): string {
  return `ainmem-recurring-buy-${actionId}`;
}

// ── the card ────────────────────────────────────────────────────────────────

export interface RecurringBuySurfaceInput {
  actionId: string;
  roomId: string;
  /** "cancelled": a member took the request back before adoption; "closed": never adopted otherwise — expired, refused, or its terms don't verify */
  state: "pending" | "live" | "stopped" | "ended" | "cancelled" | "closed";
  /** story dollars a week — the headline */
  weeklyUsd: number;
  weeks: number;
  exposureUsd: number;
  /** what one weekly buy really swaps at demo scale, in whole USDC ("0.1") */
  usdcPerWeek: string;
  approvals: number;
  required: number;
  /** a waiting request: whose approvals count so far, in order */
  approvedBy: string[];
  /** who may approve it right now (seated, in the electorate), in the room's order — the card names them */
  voterNames: string[];
  /** the viewer may approve it now (pending, seated, voting, not yet approved) */
  canApprove: boolean;
  /** why a waiting request has no Approve button for this viewer (the Treasury home's approvals card says the same) */
  approveBlocked?: "approved" | "unseated" | "not-voting";
  /** World ID approval is configured on this server */
  approvalsOpen: boolean;
  /** the viewer is a human member (may stop it) */
  canStop: boolean;
  /** a running one's progress */
  progress?: {
    weekIndex: number;
    boughtWeeks: number;
    wethOut: string;
    thisWeek: "bought" | "open" | "skipped";
    nextRunAt: string | null;
  };
  /** one line under the card: an action's outcome ("Stopped.") or why it can't be done */
  notice?: string;
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "0.0074" — enough digits for demo-scale buys without a wall of zeros */
function weth(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return "0";
  return n >= 0.01 ? n.toFixed(4) : n.toPrecision(3);
}

const text = (id: string, value: string, variant?: string): A2uiComponent => ({
  id,
  component: "Text",
  text: value,
  ...(variant ? { variant } : {}),
});
const row = (id: string, children: string[], justify?: string): A2uiComponent => ({
  id,
  component: "Row",
  children,
  ...(justify ? { justify } : {}),
});
const column = (id: string, children: string[]): A2uiComponent => ({ id, component: "Column", children });
const chip = (id: string, value: string, tone: string, icon?: string): A2uiComponent => ({
  id,
  component: "Chip",
  text: value,
  tone,
  ...(icon ? { icon } : {}),
});
/** a lucide icon by the renderer's name for it (surface.tsx ICONS) */
const icon = (id: string, name: string): A2uiComponent => ({ id, component: "Icon", name });
const button = (id: string, child: string, name: string, context: Record<string, unknown>, variant?: string): A2uiComponent => ({
  id,
  component: "Button",
  child,
  action: { event: { name, context } },
  ...(variant ? { variant } : {}),
});

const STATE_CHIP: Record<RecurringBuySurfaceInput["state"], { label: string; tone: string }> = {
  pending: { label: "Waiting for approval", tone: "waiting" },
  live: { label: "Running", tone: "success" },
  stopped: { label: "Stopped", tone: "danger" },
  ended: { label: "Finished", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  closed: { label: "Not adopted", tone: "neutral" },
};

const APPROVE_BLOCKED: Record<NonNullable<RecurringBuySurfaceInput["approveBlocked"]>, string> = {
  approved: "You approved — waiting for other verified members.",
  unseated: "No vote yet — claim yours in the treasury panel to approve.",
  "not-voting": "You joined after our rules were adopted — your approval counts once the relation re-adopts.",
};

/** an approval slot nobody has filled yet */
const EMPTY_SLOT = "—";

export function recurringBuySurface(s: RecurringBuySurfaceInput, t: T): A2uiMessage[] {
  const surfaceId = recurringBuySurfaceId(s.actionId);
  const ctx = { action_id: s.actionId, room_id: s.roomId };
  const state = STATE_CHIP[s.state];
  const root: string[] = ["head", "headline", "terms", "swap"];
  const comps: A2uiComponent[] = [
    row("head", ["title", "state"], "spaceBetween"),
    row("title", ["title_icon", "title_text"]),
    icon("title_icon", "repeat"),
    text("title_text", t("Recurring buy"), "h4"),
    chip("state", t(state.label), state.tone),
    text("headline", t("{amount} a week", { amount: usd(s.weeklyUsd) }), "h3"),
    text("terms", t("For {weeks} weeks · at most {total} in total", { weeks: s.weeks, total: usd(s.exposureUsd) }), "body"),
    // the real swap; venue and chain as the badges every treasury surface draws (the renderer maps these tones)
    row("swap", ["swap_amount", "venue", "chain"]),
    text("swap_amount", t("{usdc} USDC → WETH", { usdc: s.usdcPerWeek }), "caption"),
    chip("venue", "Uniswap v3", "uniswap"),
    chip("chain", "Base", "base"),
  ];

  if (s.state === "pending") {
    // who approves next, by name: those who did (✓), then the voters who can, then any slot no voter can fill yet
    const waiting = s.voterNames.filter((n) => !s.approvedBy.includes(n));
    const names = [...s.approvedBy.map((n) => ({ n, done: true })), ...waiting.map((n) => ({ n, done: false }))];
    const slots = Array.from({ length: Math.max(1, s.required, names.length) }, (_, i) => `slot_${i}`);
    root.push("slots", "tally");
    comps.push(
      row("slots", slots),
      ...slots.map((id, i) => {
        const who = names[i];
        return who ? chip(id, who.n, who.done ? "success" : "neutral", who.done ? "check" : undefined) : chip(id, EMPTY_SLOT, "neutral");
      }),
      text("tally", t("{got} of {need} approved", { got: Math.min(s.approvals, s.required), need: s.required }), "caption")
    );
    if (!s.canApprove && s.approveBlocked) {
      root.push("approve_blocked");
      comps.push(text("approve_blocked", t(APPROVE_BLOCKED[s.approveBlocked]), "caption"));
    }
  } else if (s.state === "live" && s.progress) {
    const p = s.progress;
    root.push("weeks", ...(p.boughtWeeks > 0 ? ["tally"] : []), "next");
    comps.push(
      {
        id: "weeks",
        component: "ProgressBar",
        value: p.weekIndex,
        max: Math.max(1, s.weeks),
        label: t("Week {k} of {n}", { k: p.weekIndex, n: s.weeks }),
      },
      ...(p.boughtWeeks > 0 ? [text("tally", t("{b} bought · {weth} WETH", { b: p.boughtWeeks, weth: weth(p.wethOut) }), "caption")] : []),
      text(
        "next",
        p.thisWeek === "open"
          ? t("This week's buy hasn't run yet")
          : p.nextRunAt
            ? t("Next buy: {day}", { day: relationDay(p.nextRunAt) })
            : t("No more buys in this window"),
        "caption"
      )
    );
  }

  if (s.notice) {
    root.push("notice");
    comps.push(text("notice", s.notice, "caption"));
  }

  // the primary action is approving, for whoever can; stopping or cancelling is a quiet one on the right
  const approve = s.state === "pending" && s.canApprove && s.approvalsOpen;
  const stop = (s.state === "pending" || s.state === "live") && s.canStop;
  if (approve || stop) root.push("divider");
  if (approve || stop) comps.push({ id: "divider", component: "Divider" });
  if (approve) {
    root.push("approve");
    comps.push(
      button("approve", "approve_label", TREASURY_APPROVE_ACTION, ctx, "primary"),
      row("approve_label", ["approve_icon", "approve_text"]),
      icon("approve_icon", "globe"),
      text("approve_text", t("Approve with World ID"))
    );
  }
  if (stop) {
    root.push("stop_row");
    comps.push(
      row("stop_row", ["stop"], "end"),
      button("stop", "stop_label", TREASURY_STOP_ACTION, ctx, s.state === "live" ? "danger" : "default"),
      text("stop_label", s.state === "live" ? t("Stop recurring buy") : t("Cancel request"))
    );
  }

  comps.unshift(column("root", root));
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: comps } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        path: "/",
        value: { action_id: s.actionId, room_id: s.roomId, state: s.state, approvals: s.approvals, required: s.required },
      },
    },
  ];
}
