// File-type → icon + tone for the preview's header, message and archive rows.
// Follows the renderer table (lib/preview-kind) so a type that previews also
// gets a matching icon, with a few finer-grained extension overrides.
import {
  FileText, FileCode, FileImage, FileType, FileSpreadsheet, FileChartColumn,
  FileArchive, FileAudio, FileVideo, File as FileGeneric, FileType2, FileAxis3d,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { extOf, previewKindFor, type PreviewKind } from "@/lib/preview-kind";

export interface FileIcon {
  Icon: LucideIcon;
  /** Tailwind text-color class for the glyph. */
  className: string;
}

type Kind = "image" | "pdf" | "code" | "doc" | "sheet" | "slide" | "archive" | "audio" | "video" | "font" | "drawing" | "default";

const ICON: Record<Kind, FileIcon> = {
  image: { Icon: FileImage, className: "text-purple-500" },
  pdf: { Icon: FileType, className: "text-red-500" },
  code: { Icon: FileCode, className: "text-teal-600" },
  doc: { Icon: FileText, className: "text-blue-500" },
  sheet: { Icon: FileSpreadsheet, className: "text-emerald-600" },
  slide: { Icon: FileChartColumn, className: "text-orange-500" },
  archive: { Icon: FileArchive, className: "text-amber-600" },
  audio: { Icon: FileAudio, className: "text-pink-500" },
  video: { Icon: FileVideo, className: "text-rose-500" },
  font: { Icon: FileType2, className: "text-slate-600" },
  drawing: { Icon: FileAxis3d, className: "text-indigo-500" },
  default: { Icon: FileGeneric, className: "text-neutral-500 dark:text-neutral-400" },
};

const EXT: Record<string, Kind> = {};
const add = (kind: Kind, exts: string[]) => exts.forEach((e) => (EXT[e] = kind));
add("doc", ["md", "markdown", "txt", "rtf", "doc", "dot", "docx", "odt", "ott", "pages", "wpd", "xps", "oxps"]);
add("sheet", ["csv", "tsv", "numbers"]);
add("slide", ["ppt", "pps", "pot", "odp", "key"]);
add("image", ["ai", "eps", "ps"]);

const BY_PREVIEW: Partial<Record<PreviewKind, Kind>> = {
  text: "code", markdown: "doc", image: "image", tiff: "image", psd: "image",
  pdf: "pdf", video: "video", audio: "audio", docx: "doc", sheet: "sheet",
  pptx: "slide", archive: "archive", font: "font", dxf: "drawing", converted: "doc",
};

/** Type icon for a file name (extension-based). */
export function fileIconForName(name: string): FileIcon {
  const kind = EXT[extOf(name)] ?? BY_PREVIEW[previewKindFor(name)];
  return kind ? ICON[kind] : ICON.default;
}

/** "12.3 KB" */
export function prettyBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
