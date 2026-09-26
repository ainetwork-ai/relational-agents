/**
 * The recurring buy as an A2UI v0.9 surface — the one card the treasurer's
 * stream, the room chat and the Treasury page all draw
 * (components/a2ui/surface.tsx). One surface per recurring-buy action, showing
 * that action as it stands now: waiting for approvals, running, or over.
 *
 * Buttons fire `ainmem.treasury.*` actions: approve (the World ID approval
 * page for that action), stop (POST to the surface route, which answers with
 * the surface redrawn), open (the Treasury page).
 *
 * Also the room-chat marker: an agent message carrying a line
 * `[[a2ui:recurring-buy/<actionId>]]` shows that card in place of the line.
 *
 * Pure: no IO, safe on the client. Text is English source run through the
 * caller's `t`.
 */

import type { T } from "@/i18n";
import { A2UI_BASIC_CATALOG, A2UI_VERSION, type A2uiComponent, type A2uiMessage } from "@/lib/x402/a2ui";

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
  /** "closed": never adopted — expired, withdrawn, refused, or its terms don't verify */
  state: "pending" | "live" | "stopped" | "ended" | "closed";
  weeklyUsd: number;
  weeks: number;
  exposureUsd: number;
  agentAddress: string;
  agentAddressUrl: string;
  digestShort: string;
  rule: string;
  approvals: number;
  required: number;
  approvedBy: string[];
  /** the viewer may approve it now (pending, seated, voting, not yet approved) */
  canApprove: boolean;
  /** World ID approval is configured on this server */
  approvalsOpen: boolean;
  /** the viewer is a human member (may stop it) */
  canStop: boolean;
  /** a running one's progress */
  progress?: {
    weekIndex: number;
    boughtWeeks: number;
    investedUsd: number;
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

function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** "0.0074" — enough digits for demo-scale buys without a wall of zeros */
function weth(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return "0";
  return n >= 0.01 ? n.toFixed(4) : n.toPrecision(3);
}

function dayUtc(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
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
  closed: { label: "Not adopted", tone: "neutral" },
};

const THIS_WEEK: Record<NonNullable<RecurringBuySurfaceInput["progress"]>["thisWeek"], string> = {
  bought: "bought",
  open: "not yet",
  skipped: "skipped",
};

export function recurringBuySurface(s: RecurringBuySurfaceInput, t: T): A2uiMessage[] {
  const surfaceId = recurringBuySurfaceId(s.actionId);
  const ctx = { action_id: s.actionId, room_id: s.roomId };
  const chip = STATE_CHIP[s.state];
  const root: string[] = ["head", "swap", "terms", "route"];
  const comps: A2uiComponent[] = [
    row("head", ["title", "state"], "spaceBetween"),
    text("title", t("🔁 Recurring buy"), "h4"),
    { id: "state", component: "Chip", text: t(chip.label), tone: chip.tone },
    row("swap", ["pay", "receive"]),
    column("pay", ["pay_label", "pay_value"]),
    text("pay_label", t("You pay"), "caption"),
    text("pay_value", t("{amount} USDC every week", { amount: usd(s.weeklyUsd) }), "body"),
    column("receive", ["receive_label", "receive_value"]),
    text("receive_label", t("You receive"), "caption"),
    text("receive_value", t("ETH (WETH) on Base"), "body"),
    text("terms", t("For {weeks} weeks · at most {total} in total", { weeks: s.weeks, total: usd(s.exposureUsd) }), "body"),
    text(
      "route",
      t("Uniswap v3 on Base · from the agent's wallet {address}", { address: shortAddress(s.agentAddress) }),
      "caption"
    ),
  ];

  if (s.state === "pending") {
    root.push("approvals", "rule");
    comps.push(
      {
        id: "approvals",
        component: "ProgressBar",
        value: s.approvals,
        max: Math.max(1, s.required),
        label: t("{n} of {m} verified humans approved", { n: s.approvals, m: s.required }),
      },
      text("rule", t("Our rule: “{rule}”", { rule: s.rule }), "caption")
    );
  } else if (s.state === "live" && s.progress) {
    const p = s.progress;
    root.push("weeks", "tally", "next", "approved_by");
    comps.push(
      {
        id: "weeks",
        component: "ProgressBar",
        value: p.weekIndex,
        max: Math.max(1, s.weeks),
        label: t("Week {k} of {n}", { k: p.weekIndex, n: s.weeks }),
      },
      text(
        "tally",
        t("Bought {b} · {invested} invested · {weth} WETH · this week: {state}", {
          b: p.boughtWeeks,
          invested: usd(p.investedUsd),
          weth: weth(p.wethOut),
          state: t(THIS_WEEK[p.thisWeek]),
        }),
        "body"
      ),
      text("next", p.nextRunAt ? t("Next buy: {day}", { day: dayUtc(p.nextRunAt) }) : t("No more buys in this window"), "caption"),
      text("approved_by", t("Approved by {names}", { names: s.approvedBy.join(", ") || "—" }), "caption")
    );
  } else if (s.approvedBy.length) {
    root.push("approved_by");
    comps.push(text("approved_by", t("Approved by {names}", { names: s.approvedBy.join(", ") }), "caption"));
  }
  root.push("digest");
  comps.push(text("digest", t("Terms {digest}", { digest: s.digestShort }), "caption"));

  if (s.notice) {
    root.push("notice");
    comps.push(text("notice", s.notice, "caption"));
  }

  const buttons: string[] = [];
  if (s.state === "pending" && s.canApprove && s.approvalsOpen) {
    buttons.push("approve");
    comps.push(
      button("approve", "approve_label", TREASURY_APPROVE_ACTION, ctx, "primary"),
      text("approve_label", t("🌍 Approve with World ID"))
    );
  }
  if ((s.state === "pending" || s.state === "live") && s.canStop) {
    buttons.push("stop");
    comps.push(
      button("stop", "stop_label", TREASURY_STOP_ACTION, ctx, "danger"),
      text("stop_label", s.state === "live" ? t("Stop recurring buy") : t("Withdraw request"))
    );
  }
  buttons.push("open");
  comps.push(button("open", "open_label", TREASURY_OPEN_ACTION, ctx), text("open_label", t("Open treasury ↗")));
  root.push("divider", "actions");
  comps.push({ id: "divider", component: "Divider" }, row("actions", buttons));

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
