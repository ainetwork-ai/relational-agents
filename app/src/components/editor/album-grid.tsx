"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { fileBytesUrl } from "@/lib/aindrive-url";

export interface AlbumFile {
  url: string;
  text?: string;
}

/**
 * An album: one file block holding several photos (`content.files`), shown as
 * a grid of square tiles — 2 across on a phone, 3 above. A tile opens the
 * photo full size; Escape or a click closes it. aindrive links load through
 * this app's access-checked proxy, like a single file block's preview.
 */
export function AlbumGrid({ blockId, files }: { blockId: string; files: AlbumFile[] }) {
  const info = useAindriveInfo();
  const [open, setOpen] = useState<number | null>(null);
  const src = (f: AlbumFile) => fileBytesUrl(f.url, info?.base);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % files.length));
      else if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + files.length) % files.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, files.length]);

  return (
    <div data-testid={`album-grid-${blockId}`} contentEditable={false} className="my-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {files.map((f, i) => (
        <button
          key={`${f.url}-${i}`}
          data-testid={`album-tile-${blockId}-${i}`}
          onClick={() => setOpen(i)}
          title={f.text}
          className="group relative aspect-square overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(f)} alt={f.text ?? ""} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
          {f.text && (
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pt-4 pb-1 text-left text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
              {f.text}
            </span>
          )}
        </button>
      ))}
      {open !== null && files[open] && (
        <div
          data-testid={`album-lightbox-${blockId}`}
          role="dialog"
          aria-label={files[open].text}
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(files[open])} alt={files[open].text ?? ""} className="max-h-full max-w-full rounded object-contain" />
          <button onClick={() => setOpen(null)} aria-label="Close" className="absolute top-3 right-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
