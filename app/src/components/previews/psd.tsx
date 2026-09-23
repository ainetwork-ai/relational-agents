"use client";
// PSD: show the flattened composite Photoshop stores alongside the layers
// (ag-psd, layer pixels skipped) through the shared image viewer.
import { useEffect, useState } from "react";
import type { Layer, PixelData } from "ag-psd";
import type { PreviewProps } from "./types";
import { usePreviewBytes } from "./use-preview-bytes";
import { PreviewLoading, PreviewMessage } from "./status";
import { ZoomableImage } from "./image";
import { rgbaToBlobUrl } from "./tiff";

const MAX_PIXELS = 100_000_000;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; url: string; width: number; height: number; layers: number; fromThumbnail: boolean };

const countLayers = (layers: Layer[] | undefined): number =>
  (layers ?? []).reduce((n, l) => n + 1 + countLayers(l.children), 0);

/** 16/32-bit composites → 8-bit RGBA for the canvas. */
function to8bit({ data }: PixelData): Uint8ClampedArray<ArrayBuffer> {
  if (data instanceof Uint8ClampedArray) return data as Uint8ClampedArray<ArrayBuffer>;
  if (data instanceof Uint8Array) return new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length);
  const out = new Uint8ClampedArray(data.length);
  if (data instanceof Uint16Array) {
    for (let i = 0; i < data.length; i++) out[i] = data[i] >> 8;
  } else {
    // 32-bit PSDs are linear light: gamma-encode colour, keep alpha linear.
    for (let i = 0; i < data.length; i++) out[i] = (i & 3) === 3 ? data[i] * 255 : Math.pow(Math.max(0, data[i]), 1 / 2.2) * 255;
  }
  return out;
}

/** Photoshop writes a blank composite when "Maximize Compatibility" is off. */
function isBlank({ data }: PixelData): boolean {
  const stride = Math.max(4, Math.floor(data.length / 4 / 4096) * 4); // ~4k samples
  for (let i = stride; i < data.length; i += stride) {
    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2] || data[i + 3] !== data[3]) return false;
  }
  return true;
}

export default function PsdPreview({ src }: PreviewProps) {
  const bytes = usePreviewBytes(src);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (bytes.status !== "ready") return;
    let cancelled = false;
    let url: string | null = null;
    const fail = (message: string) => { if (!cancelled) setState({ status: "error", message }); };
    (async () => {
      // Header check first (cheap): signature, then the size guard before we
      // allocate a width*height*4 composite.
      const head = new DataView(bytes.data, 0, Math.min(26, bytes.data.byteLength));
      if (head.byteLength < 26 || head.getUint32(0) !== 0x38425053 /* 8BPS */) {
        return fail("This file isn't a valid Photoshop document (it may be damaged).");
      }
      const height = head.getUint32(14), width = head.getUint32(18);
      if (width * height > MAX_PIXELS) {
        return fail(`This image is too large to preview (${width}×${height}). Download it to open it.`);
      }
      const { readPsd } = await import("ag-psd");
      if (cancelled) return;
      const psd = readPsd(bytes.data, {
        skipLayerImageData: true,
        useImageData: true,
        useRawThumbnail: true, // JPEG bytes — no canvas round-trip needed
      });
      const layers = countLayers(psd.children);
      const composite = psd.imageData && !(layers > 0 && isBlank(psd.imageData)) ? psd.imageData : null;
      const thumb = psd.imageResources?.thumbnailRaw;
      let fromThumbnail = false;
      if (composite) {
        url = await rgbaToBlobUrl(to8bit(composite), composite.width, composite.height);
      } else if (thumb) {
        url = URL.createObjectURL(new Blob([thumb.data as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
        fromThumbnail = true;
      } else {
        return fail("This PSD was saved without “Maximize Compatibility”, so it has no flattened image to preview. Download it to open it in Photoshop.");
      }
      if (cancelled) { URL.revokeObjectURL(url); url = null; return; }
      setState({ status: "ready", url, width: psd.width, height: psd.height, layers, fromThumbnail });
    })().catch(() => fail("Could not read this Photoshop document. It may use features the preview doesn't support — download it to open it."));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bytes]);

  if (bytes.status === "error") return <PreviewMessage name={src.name} message={bytes.message} />;
  if (state.status === "error") return <PreviewMessage name={src.name} message={state.message} />;
  if (state.status !== "ready") return <PreviewLoading />;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="tabular-nums">
          {state.width} × {state.height} · {state.layers} {state.layers === 1 ? "layer" : "layers"}
        </span>
        {state.fromThumbnail && <span>Low-resolution thumbnail</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <ZoomableImage src={state.url} alt={src.name} />
      </div>
    </div>
  );
}
