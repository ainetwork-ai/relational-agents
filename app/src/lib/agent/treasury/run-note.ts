/**
 * One weekly run's outcome in the viewer's words: the treasury panel's note
 * and the recurring-buy card's notice say the same thing. Pure; safe on the
 * client (the run's type is only a type).
 */
import type { T } from "@/i18n/translate";
import type { RecurringRunResult } from "./recurring";
import { SKIP_REASON_TEXT } from "./recurring-record";

export interface RunNote {
  tone: "ok" | "bad" | "info";
  text: string;
  /** the swap on the explorer, when one happened */
  href?: string;
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
const tokens = (amount: string) => {
  const n = Number(amount);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n) : amount;
};

export function runNote(r: RecurringRunResult, t: T): RunNote {
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
