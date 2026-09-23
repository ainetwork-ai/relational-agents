"use client";
// DXF drawing preview via dxf-viewer (three.js/WebGL). Parsing runs in a
// worker (dxf-worker.ts); the library brings its own pan/zoom controls.
import { useEffect, useRef, useState } from "react";
import { Color } from "three";
import { DxfViewer, type LayerInfo } from "dxf-viewer";
import { Layers, Maximize } from "lucide-react";
import clsx from "clsx";
import type { PreviewProps } from "./types";
import { MAX_CLIENT_PARSE_BYTES } from "./use-preview-bytes";
import { PreviewLoading, PreviewMessage } from "./status";

// Self-hosted by scripts/copy-preview-assets.mjs. Without a font, TEXT/MTEXT
// entities are silently skipped.
const FONTS = ["/preview-assets/dxf/fonts/LiberationSans-Regular.ttf"];

// The worker resolves URLs against its own script URL, so hand it absolute ones
// (fs/stream path or blob: URL — both same-origin, both fetchable from a worker).
const abs = (u: string) => new URL(u, window.location.href).href;

function fit(viewer: DxfViewer) {
  const b = viewer.GetBounds();
  const o = viewer.GetOrigin();
  if (b && o) viewer.FitView(b.minX - o.x, b.maxX - o.x, b.minY - o.y, b.maxY - o.y);
}

export default function DxfPreview({ src }: PreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<DxfViewer | null>(null);
  const [status, setStatus] = useState<{ state: "loading"; label?: string } | { state: "error"; message: string } | { state: "ready" }>({ state: "loading" });
  const [layers, setLayers] = useState<Array<LayerInfo & { visible: boolean }>>([]);
  const [showLayers, setShowLayers] = useState(false);
  const tooLarge = src.size > MAX_CLIENT_PARSE_BYTES;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || tooLarge) return;
    let cancelled = false;
    const viewer = new DxfViewer(host, {
      clearColor: new Color("#ffffff"),
      autoResize: true,
      colorCorrection: true, // white/near-white entities → dark on our white background
      antialias: true,
    });
    if (!viewer.HasRenderer()) {
      viewer.Destroy(); // still owns a canvas + worker pool even without WebGL
      host.replaceChildren();
      setStatus({ state: "error", message: "This drawing needs WebGL, which isn't available in this browser. Download it to open it." });
      return;
    }
    viewerRef.current = viewer;
    setStatus({ state: "loading" });
    viewer.Load({
      url: abs(src.url),
      fonts: FONTS.map(abs),
      progressCbk: (phase) => { if (!cancelled) setStatus({ state: "loading", label: phase === "fetch" ? "Downloading…" : phase === "font" ? "Loading fonts…" : "Preparing drawing…" }); },
      workerFactory: () => new Worker(new URL("./dxf-worker.ts", import.meta.url)),
    }).then(
      () => {
        if (cancelled) return;
        setLayers([...viewer.GetLayers(true)].map((l) => ({ ...l, visible: true })));
        setStatus({ state: "ready" });
      },
      (e: unknown) => {
        if (!cancelled) setStatus({ state: "error", message: `This drawing couldn't be displayed${e instanceof Error && e.message ? ` (${e.message})` : ""}. Download it to open it in a CAD app.` });
      },
    );
    return () => {
      cancelled = true;
      viewerRef.current = null;
      // Frees the WebGL context (browsers cap live contexts) and kills a
      // still-running parse worker.
      viewer.Destroy();
      host.replaceChildren();
    };
  }, [src.url, tooLarge]);

  if (tooLarge) return <PreviewMessage name={src.name} message="This drawing is too large to preview in the browser. Download it to open it." />;

  const toggleLayer = (name: string, visible: boolean) => {
    viewerRef.current?.ShowLayer(name, visible);
    setLayers((ls) => ls.map((l) => (l.name === name ? { ...l, visible } : l)));
  };

  return (
    <div className="relative h-full min-h-[320px] bg-white">
      {/* dxf-viewer sizes its canvas to the host and forces it to position:relative,
          so the host fills an absolutely-placed wrapper. No padding allowed. */}
      <div className="absolute inset-0">
        <div ref={hostRef} className="w-full h-full touch-none" />
      </div>
      {status.state === "loading" && (
        <div className="absolute inset-0 bg-white"><PreviewLoading label={status.label} /></div>
      )}
      {status.state === "error" && (
        <div className="absolute inset-0 bg-white"><PreviewMessage name={src.name} message={status.message} /></div>
      )}
      {status.state === "ready" && (
        <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
          <div className="flex gap-1 rounded-full bg-white/90 shadow-sm border border-neutral-200 dark:border-neutral-700 p-1">
            <button type="button" onClick={() => viewerRef.current && fit(viewerRef.current)} className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400" title="Fit to view" aria-label="Fit to view">
              <Maximize className="w-4 h-4" />
            </button>
            {layers.length > 1 && (
              <button type="button" onClick={() => setShowLayers((v) => !v)} className={clsx("p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800", showLayers ? "text-blue-500" : "text-neutral-500 dark:text-neutral-400")} title="Layers" aria-label="Layers" aria-pressed={showLayers}>
                <Layers className="w-4 h-4" />
              </button>
            )}
          </div>
          {showLayers && (
            <ul className="max-h-64 w-48 overflow-auto rounded-lg bg-white/95 shadow-sm border border-neutral-200 dark:border-neutral-700 py-1 text-xs text-neutral-800 dark:text-neutral-200">
              {layers.map((l) => (
                <li key={l.name}>
                  <label className="flex items-center gap-2 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer">
                    <input type="checkbox" checked={l.visible} onChange={(e) => toggleLayer(l.name, e.target.checked)} />
                    <span className="w-3 h-3 rounded-sm border border-neutral-200 dark:border-neutral-700 shrink-0" style={{ background: `#${l.color.toString(16).padStart(6, "0")}` }} />
                    <span className="truncate" title={l.displayName}>{l.displayName}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
