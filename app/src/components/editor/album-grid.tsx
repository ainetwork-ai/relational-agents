"use client";

import { useEffect, useMemo, useState } from "react";
import { AinuiButton, AinuiFile, DriveSurface, screen } from "@/components/ainui/surface";
import { useAindriveInfo } from "@/lib/aindrive-client";
import { fileBytesUrl, fileThumbUrl, parseAindriveUrl, aindriveFileName } from "@/lib/aindrive-url";

export interface AlbumFile {
  url: string;
  text?: string;
}

/**
 * An album: one file block holding several photos (`content.files`), shown as
 * a grid of square tiles — 2 across on a phone, 3 above (2 for four or fewer,
 * so four photos make a square rather than 3 + 1; `dense` — a folder browser —
 * 3 to 5 across). A tile opens the
 * photo full size; Escape or a click closes it. aindrive links load through
 * this app's access-checked proxy, like a single file block's preview.
 *
 * Grid tiles use thumbnails (~20 KB) for fast loading; the lightbox loads the
 * full image.
 */
export function AlbumGrid({ blockId, files, dense = false }: { blockId: string; files: AlbumFile[]; dense?: boolean }) {
  const info = useAindriveInfo();
  const [open, setOpen] = useState<number | null>(null);
  const full = (f: AlbumFile) => fileBytesUrl(f.url, info?.base);

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

  const messages = useMemo(() => screen(`album-${blockId}`, [
    { id: "root", component: "Grid", minItemWidth: dense ? 100 : 160, gap: 6, children: files.map((_, i) => `tile-${i}`) },
    ...files.map((f, i) => ({ id: `tile-${i}`, component: "Tile", media: fileThumbUrl(f.url, info?.base), label: f.text ?? "", kind: "image", action: { event: { name: "album.open", context: { index: i } } } })),
  ]), [blockId, files, dense, info?.base]);

  return (
    <div data-testid={`album-grid-${blockId}`} contentEditable={false} className="my-1">
      <DriveSurface messages={messages} onAction={(a) => { const i = Number(a.context?.index); if (Number.isInteger(i) && files[i]) setOpen(i); }} />
      {open !== null && files[open] && (
        <div
          data-testid={`album-lightbox-${blockId}`}
          role="dialog"
          aria-label={files[open].text}
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          <div onClick={(e) => e.stopPropagation()} className="max-h-full w-full max-w-5xl overflow-auto bg-white p-3 dark:bg-neutral-900">
            <AinuiFile url={full(files[open])} name={parseAindriveUrl(files[open].url, info?.base) ? aindriveFileName(parseAindriveUrl(files[open].url, info?.base)!) : files[open].url.split("/").pop() || "photo.jpg"} mime="image/jpeg" />
            <AinuiButton label="Close" onClick={() => setOpen(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
