"use client";
// Dispatches a file to its inline renderer. Each renderer is its own lazy
// chunk: pdf.js, SheetJS, three.js, libarchive wasm etc. load only when a file
// of that kind is shown. Also used by the archive viewer for its members.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { PreviewKind } from "@/lib/preview-kind";
import type { PreviewProps } from "./types";
import { PreviewLoading, PreviewMessage, NO_PREVIEW } from "./status";

const loading = () => <PreviewLoading />;
const lazy = (load: () => Promise<{ default: ComponentType<PreviewProps> }>) =>
  dynamic(load, { ssr: false, loading });

const RENDERERS: Partial<Record<PreviewKind, ComponentType<PreviewProps>>> = {
  text: lazy(() => import("./text")),
  markdown: lazy(() => import("./text")),
  image: lazy(() => import("./image")),
  tiff: lazy(() => import("./tiff")),
  psd: lazy(() => import("./psd")),
  pdf: lazy(() => import("./pdf")),
  video: lazy(() => import("./video")),
  audio: lazy(() => import("./audio")),
  docx: lazy(() => import("./docx")),
  sheet: lazy(() => import("./sheet")),
  pptx: lazy(() => import("./pptx")),
  archive: lazy(() => import("./archive")),
  font: lazy(() => import("./font")),
  dxf: lazy(() => import("./dxf")),
  converted: lazy(() => import("./converted")),
};

/** True when `kind` has an inline renderer (everything but "none"). */
export function hasInlineRenderer(kind: PreviewKind): boolean {
  return kind in RENDERERS;
}

export function PreviewBody({ kind, ...props }: PreviewProps & { kind: PreviewKind }) {
  const R = RENDERERS[kind];
  if (!R) return <PreviewMessage name={props.src.name} size={props.src.size} message={NO_PREVIEW} download={props.src.url} />;
  return <R {...props} />;
}
