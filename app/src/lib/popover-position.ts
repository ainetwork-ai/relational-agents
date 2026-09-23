/**
 * Where a popover panel goes so that it stays on screen.
 *
 * Every menu in the app had its own answer, and most of them had none: the
 * row ⠿ menu opened at the pointer and ran 60px past the bottom of the window
 * on the last row of a table. A panel needs to be placed against its trigger,
 * flipped when the space below runs out, nudged sideways when it would leave
 * the right edge, and capped (scrolling inside) when neither side is tall
 * enough.
 *
 * Pure geometry, no DOM: pass the rects in, position out.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** cap the panel to this and let it scroll — it did not fit either side */
  maxHeight: number;
  /** which side it ended up on, for the caller's animation/arrow */
  side: "below" | "above";
}

export interface FitOptions {
  /** gap between trigger and panel */
  gap?: number;
  /** keep this far from the window edges */
  margin?: number;
  /** align the panel's left edge to the anchor's left (default), its right
   * edge to the anchor's right, or its centre to the anchor's centre — the
   * row comment popover is centred on its badge in the original */
  align?: "start" | "end" | "center";
  /** cover the anchor instead of sitting under it (pickers that replace a cell) */
  cover?: boolean;
}

/**
 * Fit `panel` next to `anchor` inside `viewport`.
 *
 * Vertically: below the anchor when it fits, else above when THAT fits, else
 * whichever side has more room, capped to it. Horizontally: aligned to the
 * anchor, then clamped so both edges stay inside the margin — a panel wider
 * than the viewport is pinned to the left edge rather than centred, so its
 * first items stay readable.
 */
export function fitAnchored(
  anchor: Rect,
  panel: { width: number; height: number },
  viewport: Viewport,
  opts: FitOptions = {}
): Placement {
  const { gap = 4, margin = 8, align = "start", cover = false } = opts;

  const left = clamp(
    align === "end"
      ? anchor.right - panel.width
      : align === "center"
        ? anchor.left + anchor.width / 2 - panel.width / 2
        : anchor.left,
    margin,
    Math.max(margin, viewport.width - margin - panel.width)
  );

  const below = cover ? anchor.top : anchor.bottom + gap;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = (cover ? anchor.bottom : anchor.top - gap) - margin;

  if (panel.height <= roomBelow) {
    return { left, top: below, maxHeight: roomBelow, side: "below" };
  }
  if (panel.height <= roomAbove) {
    const bottom = cover ? anchor.bottom : anchor.top - gap;
    return { left, top: bottom - panel.height, maxHeight: roomAbove, side: "above" };
  }
 // neither side fits: take the roomier one and let the panel scroll inside it
  if (roomAbove > roomBelow) {
    return { left, top: margin, maxHeight: Math.max(0, roomAbove), side: "above" };
  }
  return { left, top: below, maxHeight: Math.max(0, roomBelow), side: "below" };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
