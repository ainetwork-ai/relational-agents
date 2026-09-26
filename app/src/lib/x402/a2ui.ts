/**
 * The gift as an A2UI v0.9 surface — the one declarative UI any agent
 * transport draws: the gift MCP tools on /api/mcp carry it in `_meta`, the
 * A2UI route (/api/gift/:id/a2ui) serves it and takes its actions, and an
 * AG-UI client can wrap it as an `a2ui-surface` activity. It mirrors
 * aindrive's surfaces (web/shared/a2ui) so a host that renders one renders
 * the other: basic catalog only, buttons fire `ainmem.gift.*` actions, and the
 * client→server `action` object is the v0.9 one aindrive's `a2ui_action`
 * takes ({name, surfaceId, sourceComponentId, timestamp, context}).
 *
 * Pure: no IO, no Node APIs. Surface text is English source keys run through
 * the caller's `t` (makeT(locale) / getT()).
 */

import type { T } from "@/i18n";
import { giftPrice } from "@/lib/gift-price";

export const A2UI_VERSION = "v0.9" as const;
export const A2UI_MIME = "application/a2ui+json";
export const A2UI_BASIC_CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
/** Where MCP tool results carry the surface for UI-only consumption. */
export const A2UI_META_KEY = "ai.ainmem/a2ui";

export type A2uiComponent = { id: string; component: string } & Record<string, unknown>;
export type A2uiMessage =
  | { version: typeof A2UI_VERSION; createSurface: { surfaceId: string; catalogId: string } }
  | { version: typeof A2UI_VERSION; updateComponents: { surfaceId: string; components: A2uiComponent[] } }
  | { version: typeof A2UI_VERSION; updateDataModel: { surfaceId: string; path?: string; value?: unknown } };

export type A2uiAction = {
  name: string;
  surfaceId?: string;
  sourceComponentId?: string;
  timestamp?: string;
  context?: Record<string, unknown>;
};

export interface GiftSurfaceInput {
  id: string;
  title: string;
  recipientName: string;
  amountKrw: number;
  /** sold through aindrive — priced in its own currency */
  sale?: { price: number; currency: string };
  usdc: string;
  settlement: string;
  previewUrl?: string;
  videoUrl?: string;
  unlock?: { byName: string; receipt: string; at: string } | null;
  /** the viewer made the gift — no paying, it is theirs */
  mine?: boolean;
  error?: string;
}

const text = (id: string, t: unknown, variant?: string): A2uiComponent => ({ id, component: "Text", text: t, ...(variant ? { variant } : {}) });
const button = (id: string, child: string, name: string, context: Record<string, unknown>, variant?: string): A2uiComponent => ({
  id,
  component: "Button",
  child,
  action: { event: { name, context } },
  ...(variant ? { variant } : {}),
});
const column = (id: string, children: string[]): A2uiComponent => ({ id, component: "Column", children });

const won = (t: T, g: GiftSurfaceInput) => giftPrice(g, (n) => t("₩{n}", { n: n.toLocaleString("ko-KR") }));

/** The gift card: locked (blurred preview + pay button) or open (video + receipt). */
export function giftSurface(g: GiftSurfaceInput, t: T): A2uiMessage[] {
  const surfaceId = `ainmem-gift-${g.id}`;
  const open = !!g.unlock || !!g.mine;
  const root: string[] = ["title", "by"];
  const comps: A2uiComponent[] = [
    text("title", `🎁 ${g.title}`, "h3"),
    text("by", t("Video by {name} · x402 · {settlement}", { name: g.recipientName, settlement: g.settlement }), "caption"),
  ];
  if (open) {
    if (g.videoUrl) {
      root.push("video");
      comps.push({ id: "video", component: "Video", url: g.videoUrl });
    }
    root.push("note");
    comps.push(
      text(
        "note",
        g.unlock
          ? t("🎁 {name} opened it with {amount} in pocket money · receipt {receipt}", { name: g.unlock.byName, amount: won(t, g), receipt: g.unlock.receipt })
          : t("This is your video. Your family sees it as a gift that opens with {amount} in pocket money.", { amount: won(t, g) }),
        "caption"
      )
    );
  } else {
    if (g.previewUrl) {
      root.push("preview");
      comps.push({ id: "preview", component: "Image", url: g.previewUrl });
    }
    root.push("pay", "terms");
    comps.push(
      button("pay", "pay_label", "ainmem.gift.pay", { gift_id: g.id }, "primary"),
      text("pay_label", t("🔒 Open with {amount} in pocket money", { amount: won(t, g) })),
      text("terms", t("x402 · {usdc} USDC → {name}'s wallet", { usdc: g.usdc, name: g.recipientName }), "caption")
    );
    if (g.error) {
      root.push("error");
      comps.push(text("error", `⚠️ ${t(g.error)}`, "caption"));
    }
  }
  comps.unshift(column("root", root));
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_BASIC_CATALOG } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: comps } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/", value: { gift_id: g.id, unlocked: open, receipt: g.unlock?.receipt ?? null } } },
  ];
}

/** The renderer's action object, or the bare event a v0.9 client may send. */
export function parseA2uiAction(raw: unknown): A2uiAction | null {
  const o = (raw && typeof raw === "object" ? (raw as { action?: unknown }).action ?? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.name !== "string") return null;
  return {
    name: o.name,
    surfaceId: typeof o.surfaceId === "string" ? o.surfaceId : undefined,
    sourceComponentId: typeof o.sourceComponentId === "string" ? o.sourceComponentId : undefined,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : undefined,
    context: o.context && typeof o.context === "object" ? (o.context as Record<string, unknown>) : undefined,
  };
}

/** What an action asks for. Only paying exists today. */
export function actionToGift(a: A2uiAction): { op: "pay"; giftId: string } | { error: string } {
  if (a.name !== "ainmem.gift.pay") return { error: `unknown action: ${a.name}` };
  const id = a.context?.gift_id ?? (a.surfaceId?.startsWith("ainmem-gift-") ? a.surfaceId.slice("ainmem-gift-".length) : undefined);
  return typeof id === "string" && id ? { op: "pay", giftId: id } : { error: "gift_id required" };
}
