"use client";

import type { PresentClient } from "@/hooks/use-presence";

/**
 * Overlay of remote carets. Each OTHER client's caret is drawn at its last
 * reported viewport coordinate (best-effort — a coarse position is fine, the
 * point is that a labelled remote caret appears per client).
 *
 * Two things this must NOT draw, because both read as "a stranger is typing
 * in the corner":
 *  - a peer with no caret of its own. Presence carries a cursor object even
 *    when the tab has no selection, so "has a cursor" is not "has a caret" —
 *    only a real x/y pair earns a caret. Merely being here shows up in the
 *    face pile instead.
 *  - your own other tabs. Presence is keyed per tab, so a second tab of yours
 *    arrives as a peer wearing your name; the face pile already dedupes by
 *    userId, and this follows that rule.
 */
export function LiveCursors({
  others,
  selfUserId,
}: {
  others: PresentClient[];
  selfUserId?: string;
}) {
  const withCursor = others.filter(
    (o) =>
      o.user.id !== selfUserId &&
      typeof o.cursor?.x === "number" &&
      typeof o.cursor?.y === "number"
  );
  if (withCursor.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {withCursor.map((o) => {
        const x = o.cursor?.x as number;
        const y = o.cursor?.y as number;
        return (
          <div
            key={o.clientId}
            data-testid={`live-cursor-${o.clientId}`}
            style={{ left: x, top: y, color: o.color }}
            className="absolute -translate-y-1 transition-all duration-100"
          >
            <div
              style={{ backgroundColor: o.color }}
              className="h-4 w-0.5"
            />
            <div
              style={{ backgroundColor: o.color }}
              className="whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium leading-none text-white shadow"
            >
              {o.cursor?.label ?? o.user.displayName}
            </div>
          </div>
        );
      })}
    </div>
  );
}
