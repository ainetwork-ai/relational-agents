"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { fitAnchored, type FitOptions } from "@/lib/popover-position";

/**
 * Place a portalled popover against its trigger and keep it on screen.
 *
 * The panel is measured after it mounts — its height depends on its content —
 * and then `fitAnchored` picks the side. Recomputed on resize and when the
 * Scrolling is the browser's job, not ours. Where CSS anchor positioning
 * exists (Chrome 125+), the panel is tied to its trigger with
 * `anchor-name`/`position-anchor` and the browser keeps them together — no JS
 * in the scroll path, so no trailing behind the compositor, and the panel does
 * NOT close itself just because the row moved. `position-try-fallbacks` does
 * the flip. Without anchor positioning (Safari, Firefox) we fall back to
 * re-placing on scroll: a frame behind, but attached and still open.
 * The panel must be portalled and `fixed`: left in the page it would be
 * clipped by the table's or the sidebar's own overflow.
 *
 *   const trigger = useRef<HTMLButtonElement>(null);
 *   const panel = useRef<HTMLDivElement>(null);
 *   useAnchored(open, trigger, panel);
 *   … createPortal(
 *       <div ref={panel} style={{ visibility: "hidden" }} className="fixed …">,
 *       document.body)
 *
 * left/top/max-height are written straight onto the element: placement is
 * layout, not data, so it needs no render pass of its own (and a panel that
 * fits nowhere gets a max-height and scrolls inside instead of running off the
 * window). `data-side` is left on the element for anyone styling by side.
 * Start the panel `visibility: hidden` — the hook reveals it once placed, so
 * it never paints at 0,0. Pair with `useDismiss` for closing.
 */
export function useAnchored(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  opts: FitOptions = {}
): void {
  const { gap, margin, align, cover } = opts;

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    applyPlacement(panelRef.current, trigger.getBoundingClientRect(), { gap, margin, align, cover }, trigger);
  }, [triggerRef, panelRef, gap, margin, align, cover]);

 // before the browser paints the open panel
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
 // only engines without CSS anchoring need us in the scroll path
    if (!CSS_ANCHORING) window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);

  useReplaceOnGrow(open, panelRef, place);
}

/**
 * The same placement, anchored to a POINT rather than an element — the caret,
 * for the slash / mention / emoji menus. `y` is the caret's top, and the anchor
 * is treated as one line tall so "below" means below the line and a flip puts
 * the menu above it. These menus had `top: anchor.y + 24` and nothing else, so
 * near the bottom of the window they ran off it — the mention list by 250px.
 */
export function useAnchoredAt(
  open: boolean,
  point: { x: number; y: number } | null,
  panelRef: RefObject<HTMLElement | null>,
  opts: FitOptions & { lineHeight?: number } = {}
): void {
  const { gap, margin, align, cover, lineHeight = 22 } = opts;
  const x = point?.x ?? 0;
  const y = point?.y ?? 0;

  const place = useCallback(() => {
    if (!point) return;
    applyPlacement(
      panelRef.current,
      { left: x, top: y, right: x, bottom: y + lineHeight, width: 0, height: lineHeight },
      { gap, margin, align, cover }
    );
 // eslint-disable-next-line react-hooks/exhaustive-deps -- x/y stand in for `point`
  }, [panelRef, x, y, lineHeight, gap, margin, align, cover]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  useReplaceOnGrow(open, panelRef, place);
}


/**
 * Re-place when the panel's CONTENT changes size.
 *
 * A menu that loads its rows (the mention list fetches members) is short when
 * it opens and taller a moment later, and it kept the position it was given —
 * 101px off the bottom of the window. Keyed on scrollHeight, not the box: the
 * max-height we write changes the box, and reacting to that would loop.
 */
function useReplaceOnGrow(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  place: () => void
): void {
  const natural = useRef(0);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === "undefined") return;
    natural.current = panel.scrollHeight;
    const ro = new ResizeObserver(() => {
      const h = panel.scrollHeight;
      if (Math.abs(h - natural.current) < 1) return;
      natural.current = h;
      place();
    });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [open, panelRef, place]);
}

let anchorSeq = 0;
const CSS_ANCHORING =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("anchor-name: --a");

/**
 * Tie the panel to the trigger in CSS so the browser keeps them together.
 * Returns false when the engine has no anchor positioning and JS must do it.
 */
function cssAnchor(
  trigger: HTMLElement,
  panel: HTMLElement,
  opts: FitOptions
): boolean {
  if (!CSS_ANCHORING) return false;
  const name = panel.dataset.anchorName ?? `--pop-${++anchorSeq}`;
  panel.dataset.anchorName = name;
  trigger.style.setProperty("anchor-name", name);
  panel.style.setProperty("position-anchor", name);
  const gap = opts.gap ?? 4;
 // `cover` pickers REPLACE the cell rather than hang under it — the original's
 // Status menu starts at the cell's own top-left (measured: −1,−1, see
 // e2e/fixtures/notion-status-dropdown.json). Sending those through
 // anchor(bottom) put them 40px below the cell.
  panel.style.top = opts.cover ? "anchor(top)" : `calc(anchor(bottom) + ${gap}px)`;
  panel.style.bottom = "auto";
  if (opts.align === "end") {
    panel.style.left = "auto";
    panel.style.right = `calc(anchor(right) * -1 + 100%)`;
  } else {
    panel.style.left = "anchor(left)";
    panel.style.right = "auto";
  }
 // the browser flips it above / to the other side when it would not fit, and
 // re-evaluates that on every scroll, for free
  panel.style.setProperty("position-try-fallbacks", "flip-block, flip-inline, flip-block flip-inline");
 // NOT `position-visibility: no-overflow`: that hides the panel once the anchor
 // scrolls out of view, which is the same "it vanished and I never closed it"
 // the scroll-dismissal caused. A menu closes when the user closes it.
  return true;
}

/** Write a fitted position onto the panel. See useAnchored for why it is direct. */
function applyPlacement(
  panel: HTMLElement | null,
  anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  opts: FitOptions,
  trigger?: HTMLElement | null
): void {
  if (!panel) return;
 // drop a previous cap first, or the panel measures as its capped self and
 // would keep shrinking every time this runs
  panel.style.maxHeight = "";
  const at = fitAnchored(
    anchor,
    { width: panel.offsetWidth, height: panel.scrollHeight },
    { width: window.innerWidth, height: window.innerHeight },
    opts
  );
 // the cap keeps a tall menu scrolling inside itself either way
  panel.style.maxHeight = `${Math.max(at.maxHeight, Math.min(at.maxHeight, window.innerHeight - 16))}px`;
  if (!(trigger && cssAnchor(trigger, panel, opts))) {
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
  }
  panel.dataset.side = at.side;
  panel.style.visibility = "visible";
}
