"use client";

import { useEffect, useState } from "react";
import { X, Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Block } from "@/lib/db/schema";
import { useDb } from "./database-block";
import { PropertyCell } from "./property-cell";
import { BlockEditor } from "@/components/editor/block-editor";

/** Opens a database row as a page. Like , the default is a SIDE PEEK: a
 * panel that slides in from the right with the row's properties + a full block
 * editor, the page still visible behind it. "Open as full page" navigates to
 * the row's own page route. */
export function RowPeek({ rowId, onClose }: { rowId: string; onClose: () => void }) {
  const db = useDb();
  const router = useRouter();
  const row = db.rows.find((r) => r.id === rowId);
  const titleProp = db.properties.find((p) => p.type === "title");
  const bodyPageId = row?.values["__page"];
  const [blocks, setBlocks] = useState<Block[] | null>(null);

  useEffect(() => {
    if (typeof bodyPageId !== "string") return;
    let alive = true;
    fetch(`/api/pages/${bodyPageId}/blocks`)
      .then((r) => (r.ok ? r.json() : { blocks: [] }))
      .then((d) => alive && setBlocks(d.blocks));
    return () => {
      alive = false;
    };
  }, [bodyPageId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) return null;

  return (
 // side-peek: dim the page a touch, dock the panel to the right edge
    <div className="fixed inset-0 z-50 flex justify-end bg-black/10" onClick={onClose}>
      <div
        data-testid="db-row-peek"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-[560px] overflow-y-auto border-l border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-[#191919]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white/90 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-[#191919]/90">
          {typeof bodyPageId === "string" ? (
            <button
              data-testid="db-peek-open-full"
              onClick={() => router.push(`/p/${bodyPageId}`)}
              aria-label="Open as full page"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <Maximize2 size={14} /> Open as page
            </button>
          ) : (
            <span />
          )}
          <button
            data-testid="db-peek-close"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-8 py-6">
          {/* title */}
          {titleProp && (
            <div className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
              <PropertyCell prop={titleProp} row={row} />
            </div>
          )}

          {/* properties */}
          <div className="mb-6 space-y-1">
            {db.properties
              .filter((p) => p.type !== "title")
              .map((p) => (
                <div key={p.id} className="flex items-start gap-2">
                  <span className="mt-1.5 w-28 shrink-0 text-sm text-neutral-400">{p.name}</span>
                  <div className="min-w-0 flex-1">
                    <PropertyCell prop={p} row={row} />
                  </div>
                </div>
              ))}
          </div>

          {/* body — a real page editor */}
          <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800">
            {typeof bodyPageId === "string" && blocks ? (
              <BlockEditor pageId={bodyPageId} initialBlocks={blocks} />
            ) : (
              <div className="h-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
