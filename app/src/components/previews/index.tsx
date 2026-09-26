"use client";
// Public entry point: <FilePreview src={{ name, url, size }} /> renders any
// file inline, choosing the renderer from the file name (lib/preview-kind —
// every type Google Drive previews). See README.md in this folder.
import { useMemo } from "react";
import clsx from "clsx";
import { Download } from "lucide-react";
import { useT } from "@/i18n/provider";
import { previewKindFor, type PreviewKind } from "@/lib/preview-kind";
import type { PreviewSource } from "./types";
import { bytesLoader } from "./use-preview-bytes";
import { PreviewBody } from "./body";
import { fileIconForName, prettyBytes } from "./file-icon";

export { previewKindFor } from "@/lib/preview-kind";
export type { PreviewKind } from "@/lib/preview-kind";

export interface FileSource {
  /** File name (basename) — the renderer is chosen from its extension. */
  name: string;
  /** Same-origin URL returning the raw bytes (e.g. /uploads/x.pdf). */
  url: string;
  /** Byte size, when known — guards client-side parsing of huge files. */
  size?: number;
}

// Renderers that lay out against a definite height (scrolling pages, a
// sandboxed frame, a WebGL canvas, a sheet grid…). In compact mode they get a
// fixed box; the rest (text, audio, font, message cards) size to content up
// to the same cap.
const FIXED_HEIGHT: ReadonlySet<PreviewKind> = new Set<PreviewKind>(["image", "pdf", "docx", "pptx", "sheet", "dxf", "video", "archive", "tiff", "psd"]);

export function FilePreview({
  src,
  className,
  compact = false,
  header = true,
}: {
  src: FileSource;
  className?: string;
  compact?: boolean;
  /** false when the host already shows the name and a download (a file block) */
  header?: boolean;
}) {
  const t = useT();
  const { name, url, size } = src;
  // One memoized fetch per file; keyed on url so a new file never reuses bytes.
  const source = useMemo<PreviewSource>(() => ({ name, url, size: size ?? 0, bytes: bytesLoader(url) }), [name, url, size]);
  const kind = previewKindFor(name);
  const { Icon, className: tone } = fileIconForName(name);

  return (
    <div
      className={clsx(
        "flex flex-col min-w-0 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-[#191919]",
        !compact && "h-full",
        className,
      )}
    >
      {header && <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-700">
        <Icon className={clsx("w-4 h-4 shrink-0", tone)} />
        <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-200" title={name}>{name}</span>
        {size ? <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">{prettyBytes(size)}</span> : null}
        {/* Download only — no "open in new tab": an html/svg opened as a
            document on our origin could run script. */}
        <a
          href={url}
          download={name}
          className="shrink-0 p-1 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200"
          title={t("Download")}
          aria-label={t("Download {name}", { name })}
        >
          <Download className="w-4 h-4" />
        </a>
      </div>}
      <div
        className={clsx(
          "min-h-0 overflow-auto",
          !compact ? "flex-1" : FIXED_HEIGHT.has(kind) ? "h-[440px]" : "max-h-[440px]",
        )}
      >
        {/* Keyed by url: renderers may assume their source never changes. */}
        <PreviewBody key={url} kind={kind} src={source} />
      </div>
    </div>
  );
}
