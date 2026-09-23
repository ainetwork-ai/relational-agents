"use client";
// Legacy Office / iWork / PostScript / XPS. aindrive converts these to PDF in a
// server sidecar; this app has no converter, so they get a download card.
import type { PreviewProps } from "./types";
import { PreviewMessage, NO_PREVIEW } from "./status";

export default function ConvertedPreview({ src }: PreviewProps) {
  return <PreviewMessage name={src.name} size={src.size} message={NO_PREVIEW} download={src.url} />;
}
