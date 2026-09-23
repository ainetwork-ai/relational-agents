"use client";
import { useState } from "react";
import clsx from "clsx";
import type { PreviewProps } from "./types";

// Subtle checkerboard so transparent images read against the white panel.
export const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#f1f3f4 25%,transparent 25%),linear-gradient(-45deg,#f1f3f4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f3f4 75%),linear-gradient(-45deg,transparent 75%,#f1f3f4 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
};

/**
 * Fit-to-width image with click-to-toggle 1:1 zoom. Also the display surface
 * for decoded formats (TIFF, PSD) — they hand it a blob: URL of a PNG.
 */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div
      className={clsx("flex items-center justify-center p-4", zoomed ? "min-h-full min-w-full w-max cursor-zoom-out" : "h-full cursor-zoom-in")}
      style={CHECKERBOARD}
      onClick={() => setZoomed((v) => !v)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={clsx("rounded-md shadow-sm", zoomed ? "max-w-none" : "max-w-full max-h-full object-contain")} />
    </div>
  );
}

export default function ImagePreview({ src }: PreviewProps) {
  return <ZoomableImage src={src.url} alt={src.name} />;
}
