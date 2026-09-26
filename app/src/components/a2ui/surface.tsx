"use client";

/**
 * Draws an A2UI v0.9 surface — the basic-catalog subset the treasury's cards
 * use (Column, Row, Text, Chip, Button, ProgressBar, Divider; a Chip whose tone
 * is "uniswap", "base" or "sepolia" is drawn as the app's venue / chain badge)
 * — and runs its `ainmem.treasury.*` actions:
 *   approve → the World ID approval page for that action (comes back here)
 *   stop    → asks once, inline, then POSTs to the card's surface route, which
 *             answers with it redrawn
 *   open    → the Treasury page
 * Either `messages` (the treasurer's stream hands them over) or `src` (the
 * room chat fetches the card) — a card with `src` refetches when the tab
 * regains focus, so approvals given elsewhere show up.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/i18n/provider";
import { ChainBadge, UniswapBadge } from "@/components/chain/chain-badge";
import type { A2uiComponent, A2uiMessage } from "@/lib/x402/a2ui";
import { TREASURY_APPROVE_ACTION, TREASURY_OPEN_ACTION, TREASURY_STOP_ACTION } from "@/lib/agent/treasurer/surfaces";

/** nesting bound: a malformed surface that names itself as its own child must not recurse forever */
const MAX_DEPTH = 12;

type ActionEvent = { name: string; context: Record<string, unknown> };

function componentsOf(messages: A2uiMessage[]): {
  surfaceId: string | null;
  byId: Map<string, A2uiComponent>;
  model: Record<string, unknown>;
} {
  const byId = new Map<string, A2uiComponent>();
  let surfaceId: string | null = null;
  let model: Record<string, unknown> = {};
  for (const m of messages) {
    if ("createSurface" in m) surfaceId = m.createSurface.surfaceId;
    else if ("updateComponents" in m) for (const c of m.updateComponents.components) byId.set(c.id, c);
    else if ("updateDataModel" in m && (m.updateDataModel.path ?? "/") === "/" && m.updateDataModel.value && typeof m.updateDataModel.value === "object")
      model = m.updateDataModel.value as Record<string, unknown>;
  }
  return { surfaceId, byId, model };
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { literalString?: unknown }).literalString === "string")
    return (v as { literalString: string }).literalString;
  return "";
}

function actionOf(c: A2uiComponent): ActionEvent | null {
  const ev = (c.action as { event?: { name?: unknown; context?: unknown } } | undefined)?.event;
  if (!ev || typeof ev.name !== "string") return null;
  return { name: ev.name, context: ev.context && typeof ev.context === "object" ? (ev.context as Record<string, unknown>) : {} };
}

const TEXT_CLASS: Record<string, string> = {
  h3: "text-base font-semibold text-neutral-900 dark:text-neutral-100",
  h4: "text-[15px] font-semibold text-neutral-900 dark:text-neutral-100",
  caption: "text-xs text-neutral-500 dark:text-neutral-400",
  body: "text-sm text-neutral-800 dark:text-neutral-200",
};

const CHIP_CLASS: Record<string, string> = {
  waiting: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  danger: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  neutral: "bg-neutral-100 text-neutral-600 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-900";

const BUTTON_CLASS: Record<string, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white",
  danger:
    "text-red-600 ring-1 ring-red-200 hover:bg-red-50 active:bg-red-100 dark:text-red-400 dark:ring-red-900 dark:hover:bg-red-950/40",
  default:
    "text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-800",
};

function surfaceUrl(context: Record<string, unknown>): string | null {
  const room = context.room_id;
  const action = context.action_id;
  return typeof room === "string" && typeof action === "string"
    ? `/api/treasury/${encodeURIComponent(room)}/surfaces/recurring-buy/${encodeURIComponent(action)}`
    : null;
}

export function A2uiSurface({ messages: given, src }: { messages?: A2uiMessage[]; src?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [fetched, setFetched] = useState<A2uiMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // the Stop button asks once, in place, before it POSTs
  const [confirming, setConfirming] = useState<string | null>(null);
  // a stop the server refused or never answered: said where the button was
  const [stopFailed, setStopFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;
    let live = true;
    const load = () => {
      fetch(src, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<{ messages?: A2uiMessage[] }>) : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (!live) return;
          setFetched(Array.isArray(data.messages) ? data.messages : null);
          setFailed(false);
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [src]);

  // a card redrawn by its own action wins over what the caller first handed in
  const messages = fetched ?? given ?? null;
  const { surfaceId, byId, model } = useMemo(() => componentsOf(messages ?? []), [messages]);
  // a stop on a running buy ends it; on a request still waiting it withdraws it
  const live = model.state === "live";

  const stop = useCallback(
    async (c: A2uiComponent, ev: ActionEvent) => {
      const url = src ?? surfaceUrl(ev.context);
      if (!url) return;
      setConfirming(null);
      setStopFailed(null);
      setBusy(c.id);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: {
              name: ev.name,
              surfaceId: surfaceId ?? undefined,
              sourceComponentId: c.id,
              timestamp: new Date().toISOString(),
              context: ev.context,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { messages?: A2uiMessage[] };
        if (Array.isArray(data.messages)) setFetched(data.messages);
        else if (!res.ok) setStopFailed(c.id);
      } catch {
        setStopFailed(c.id);
      } finally {
        setBusy(null);
      }
    },
    [src, surfaceId]
  );

  const run = useCallback(
    (c: A2uiComponent, ev: ActionEvent) => {
      if (ev.name === TREASURY_APPROVE_ACTION) {
        const id = ev.context.action_id;
        if (typeof id !== "string") return;
        // leaving for the approval page: the button says so and can't be pressed twice
        setBusy(c.id);
        const back = `${window.location.pathname}${window.location.search}`;
        window.location.assign(
          `/api/auth/world/connect?action=${encodeURIComponent(id)}&returnTo=${encodeURIComponent(back)}`
        );
      } else if (ev.name === TREASURY_OPEN_ACTION) {
        const room = ev.context.room_id;
        if (typeof room === "string") router.push(`/treasury/${encodeURIComponent(room)}`);
      } else if (ev.name === TREASURY_STOP_ACTION) {
        setStopFailed(null);
        setConfirming(c.id);
      }
    },
    [router]
  );

  if (!messages) {
    if (failed)
      return <p className="text-xs text-neutral-400">{t("This card isn't available.")}</p>;
    // about the height of a drawn card, so the conversation doesn't jump when it lands
    return (
      <div
        className="h-64 w-full max-w-sm animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800"
        aria-label={t("Loading card…")}
      />
    );
  }
  if (!byId.has("root")) return null;

  const render = (id: string, depth: number): ReactNode => {
    const c = byId.get(id);
    if (!c || depth > MAX_DEPTH) return null;
    const children = Array.isArray(c.children) ? (c.children as unknown[]).filter((x): x is string => typeof x === "string") : [];
    switch (c.component) {
      case "Column":
        return (
          <div key={id} className="flex min-w-0 flex-col gap-1.5">
            {children.map((k) => render(k, depth + 1))}
          </div>
        );
      case "Row": {
        const kinds = children.map((k) => byId.get(k)?.component);
        const gap = kinds.some((k) => k === "Chip") ? "gap-x-1.5 gap-y-1" : kinds.some((k) => k === "Button") ? "gap-x-3 gap-y-2" : "gap-x-6 gap-y-2";
        return (
          <div
            key={id}
            className={`flex min-w-0 flex-wrap items-center ${gap} ${c.justify === "spaceBetween" ? "justify-between" : ""}`}
          >
            {children.map((k) => render(k, depth + 1))}
          </div>
        );
      }
      case "Text": {
        const variant = typeof c.variant === "string" ? c.variant : "body";
        return (
          <p key={id} className={`${TEXT_CLASS[variant] ?? TEXT_CLASS.body} [overflow-wrap:anywhere] tabular-nums`}>
            {textOf(c.text)}
          </p>
        );
      }
      case "Chip": {
        const tone = typeof c.tone === "string" ? c.tone : "neutral";
        if (tone === "uniswap") return <UniswapBadge key={id} />;
        if (tone === "base" || tone === "sepolia") return <ChainBadge key={id} chain={tone} />;
        return (
          <span
            key={id}
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CHIP_CLASS[tone] ?? CHIP_CLASS.neutral}`}
          >
            {textOf(c.text)}
          </span>
        );
      }
      case "ProgressBar": {
        const max = typeof c.max === "number" && c.max > 0 ? c.max : 1;
        const value = typeof c.value === "number" ? Math.min(max, Math.max(0, c.value)) : 0;
        return (
          <div key={id} className="flex flex-col gap-1 py-0.5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={value}
            >
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${(value / max) * 100}%` }} />
            </div>
            {typeof c.label === "string" && (
              <span className="text-xs text-neutral-600 tabular-nums dark:text-neutral-300">{c.label}</span>
            )}
          </div>
        );
      }
      case "Divider":
        return <hr key={id} className="my-1 border-neutral-200 dark:border-neutral-700" />;
      case "Button": {
        const ev = actionOf(c);
        const variant = typeof c.variant === "string" ? c.variant : "default";
        const label = typeof c.child === "string" ? render(c.child, depth + 1) : null;
        const room = ev?.context.room_id;
        if (ev?.name === TREASURY_OPEN_ACTION && typeof room === "string" && pathname.startsWith(`/treasury/${room}`)) return null;
        if (ev?.name === TREASURY_STOP_ACTION && (confirming === id || stopFailed === id))
          return (
            <span key={id} data-testid="a2ui-stop-confirm" className="inline-flex h-8 items-center gap-2 text-sm">
              <span className={stopFailed === id ? "text-red-700 dark:text-red-300" : "text-neutral-600 dark:text-neutral-300"}>
                {stopFailed === id ? t("Couldn't stop it.") : live ? t("Stop it for good?") : t("Withdraw it?")}
              </span>
              <button
                type="button"
                data-testid="a2ui-stop-yes"
                disabled={busy !== null}
                onClick={() => void stop(c, ev)}
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors disabled:opacity-50 ${BUTTON_CLASS.danger} ${FOCUS}`}
              >
                {stopFailed === id ? t("Try again") : live ? t("Yes, stop") : t("Yes, withdraw")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  setStopFailed(null);
                }}
                className={`rounded px-1 text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 ${FOCUS}`}
              >
                {t("Keep it")}
              </button>
            </span>
          );
        return (
          <button
            key={id}
            type="button"
            disabled={!ev || busy !== null}
            data-testid={`a2ui-${ev?.name ?? "button"}`}
            onClick={() => ev && run(c, ev)}
            className={`h-8 rounded-lg px-3 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 [&_p]:text-inherit ${BUTTON_CLASS[variant] ?? BUTTON_CLASS.default} ${FOCUS}`}
          >
            {busy === id
              ? ev?.name === TREASURY_APPROVE_ACTION
                ? t("Opening World ID…")
                : t("Working…")
              : label}
          </button>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div
      data-testid="a2ui-surface"
      data-surface-id={surfaceId ?? undefined}
      className="w-full max-w-sm rounded-2xl bg-white p-4 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-700"
    >
      {render("root", 0)}
    </div>
  );
}
