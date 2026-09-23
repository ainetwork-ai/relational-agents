"use client";

import { useEffect, useState } from "react";
import type { PresentClient } from "@/hooks/use-presence";

/**
 * Overlay of remote carets. A remote caret is a DOCUMENT position — block id
 * + character offset — resolved against THIS viewer's DOM every time it can
 * have moved (scroll, resize, the text shifting under it, a new report). So
 * it sits in the other person's actual line and scrolls with the page, the
 * way the original's collaborator carets do. Before this, the sender's own
 * viewport x/y was painted onto a fixed layer here: the caret hung in the
 * air while you scrolled, and with no position at all it sat at the page's
 * top-left corner where nothing can be edited.
 *
 * A client whose caret isn't in any block draws nothing — not a caret in a
 * default spot.
 */
export function LiveCursors({ others }: { others: PresentClient[] }) {
  const anchored = others.filter((o) => o.cursor?.blockId);
  const [placed, setPlaced] = useState<
    { clientId: string; x: number; y: number; h: number; color: string; label: string }[]
  >([]);

  useEffect(() => {
    if (anchored.length === 0) {
      setPlaced((prev) => (prev.length ? [] : prev));
      return;
    }
    let raf = 0;
    const place = () => {
      raf = 0;
      const next: typeof placed = [];
      for (const o of anchored) {
        const rect = caretRectAt(o.cursor!.blockId!, o.cursor!.offset ?? 0);
        if (!rect) continue; // block not on this viewer's screen → no caret
        next.push({
          clientId: o.clientId,
          x: rect.left,
          y: rect.top,
          h: rect.height || 16,
          color: o.color,
          label: o.cursor?.label ?? o.user.displayName,
        });
      }
      setPlaced(next);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
 // scroll on any scroller (the page's <main> scrolls, not the window), a
 // resize, and — for text shifting under the caret while someone types — a
 // slow fallback tick; a fresh presence report re-runs the effect itself
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const iv = setInterval(schedule, 500);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      clearInterval(iv);
    };
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others]);

  if (placed.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {placed.map((p) => (
        <div
          key={p.clientId}
          data-testid={`live-cursor-${p.clientId}`}
          style={{ left: p.x, top: p.y, color: p.color }}
          className="absolute"
        >
          <div style={{ backgroundColor: p.color, height: p.h }} className="w-0.5" />
          <div
            style={{ backgroundColor: p.color }}
            className="absolute left-0 top-full mt-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium leading-none text-white shadow"
          >
            {p.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Viewport rect of the caret at `offset` innerText characters into the block's
 * editable, walking text nodes the way setCaret() does. An empty block (no text
 * node) anchors on the editable's own box. Null when the block isn't in the DOM. */
function caretRectAt(blockId: string, offset: number): DOMRect | null {
  const el = document.querySelector(`[data-testid="block-editable-${blockId}"]`);
  if (!(el instanceof HTMLElement)) return null;
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let lastText: Node | null = null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      placed = true;
      break;
    }
    remaining -= len;
    lastText = node;
    node = walker.nextNode();
  }
  if (!placed) {
    if (lastText) range.setStart(lastText, lastText.textContent?.length ?? 0);
    else {
 // empty block: the editable's box, caret at its left edge
      const r = el.getBoundingClientRect();
      return new DOMRect(r.left, r.top, 0, r.height);
    }
  }
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left, r.top, 0, r.height);
}
