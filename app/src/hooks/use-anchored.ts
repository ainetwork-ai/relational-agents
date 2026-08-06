"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { fitAnchored, type FitOptions } from "@/lib/popover-position";

/**
 * Place a portalled popover against its trigger and keep it on screen.
 *
 * The panel is measured after it mounts — its height depends on its content —
 * and then `fitAnchored` picks the side. Recomputed on resize and on any
 * ancestor's scroll, since anything that moves the trigger moves the panel.
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
    const panel = panelRef.current;
    if (!trigger || !panel) return;
 // drop a previous cap first, or the panel measures as its capped self and
 // would keep shrinking every time this runs
    panel.style.maxHeight = "";
    const at = fitAnchored(
      trigger.getBoundingClientRect(),
      { width: panel.offsetWidth, height: panel.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { gap, margin, align, cover }
    );
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
    panel.style.maxHeight = `${at.maxHeight}px`;
    panel.dataset.side = at.side;
    panel.style.visibility = "visible";
  }, [triggerRef, panelRef, gap, margin, align, cover]);

 // before the browser paints the open panel
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("resize", onMove);
 // capture: also catches scrolling of an ancestor (the table, the sidebar, a peek)
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, place]);
}
