"use client";

import type { PresentClient } from "@/hooks/use-presence";

/**
 * Overlay of remote carets. Each OTHER client's caret is drawn at its last
 * reported viewport coordinate (best-effort — a coarse position is fine, the
 * point is that a labelled remote caret appears per client).
 */
export function LiveCursors({ others }: { others: PresentClient[] }) {
  const withCursor = others.filter((o) => o.cursor);
  if (withCursor.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {withCursor.map((o) => {
        const x = o.cursor?.x ?? 8;
        const y = o.cursor?.y ?? 8;
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
