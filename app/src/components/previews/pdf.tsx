"use client";
// pdf.js viewer: vertical page scroll, fit-to-width, lazy per-page rendering.
// Used for .pdf, PDF-compatible Illustrator .ai, and (via PdfDocument) the
// server-converted PDFs of doc/ppt/eps/xps/… — so it must work on mobile too
// (the old <iframe src> relied on the browser's built-in viewer, which mobile
// browsers don't have).
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Minus, Plus, Scan } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PreviewProps } from "./types";
import { PreviewLoading, PreviewMessage } from "./status";

type PdfJs = typeof import("pdfjs-dist");

// Self-hosted by scripts/copy-preview-assets.mjs — the CSP blocks CDNs.
const ASSETS = "/preview-assets/pdfjs";
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${ASSETS}/pdf.worker.min.mjs`;
    return m;
  });
  pdfjsPromise.catch(() => { pdfjsPromise = null; });
  return pdfjsPromise;
}

const ZOOM_STEP = 1.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const PAD = 12;      // scroll-container padding (matches p-3)
// Keep canvases under iOS Safari's ~16.7M-pixel limit; beyond it the canvas
// silently renders blank. We lower the device-pixel ratio instead.
const MAX_CANVAS_PIXELS = 16_000_000;

type LoadState =
  | { status: "loading" }
  | { status: "password"; incorrect: boolean; submit: (pw: string) => void }
  | { status: "error"; message: string }
  | { status: "ready"; doc: PDFDocumentProxy; aspect: number };

function errorMessage(e: unknown, name: string): string {
  const err = e as { name?: string; status?: number; message?: string };
  if (err?.name === "InvalidPDFException") {
    return /\.ai$/i.test(name)
      ? "This Illustrator file wasn't saved with PDF compatibility, so it can't be previewed. Download it to open it in Illustrator."
      : "This file isn't a valid PDF (it may be damaged). Download it to open it locally.";
  }
  if (err?.name === "ResponseException" || err?.name === "MissingPDFException") {
    return err.status ? `Could not load the file (${err.status}).` : "Could not load the file.";
  }
  return err?.message ? `Could not display this PDF: ${err.message}` : "Could not display this PDF.";
}

/** Renders a PDF from a same-origin URL. Reused by `converted` for server-converted output. */
export function PdfDocument({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      const loadingTask = pdfjs.getDocument({
        url,
        cMapUrl: `${ASSETS}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}/standard_fonts/`,
        wasmUrl: `${ASSETS}/wasm/`,
        // fs/stream honours Range: fetch 512 KiB chunks on demand instead of
        // pulling a 200 MB scan whole before page 1 shows.
        rangeChunkSize: 512 * 1024,
        disableAutoFetch: true,
        disableStream: true,
      });
      task = loadingTask;
      // Encrypted PDF: ask, then feed the answer back into the SAME task, so a
      // retry doesn't re-download the file. reason 2 = INCORRECT_PASSWORD.
      loadingTask.onPassword = (update: (pw: string) => void, reason: number) => {
        if (!cancelled) setState({ status: "password", incorrect: reason === 2, submit: (pw) => { setState({ status: "loading" }); update(pw); } });
      };
      const doc = await loadingTask.promise;
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      if (!cancelled) setState({ status: "ready", doc, aspect: vp.height / vp.width });
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: "error", message: errorMessage(e, name) });
    });
    return () => {
      cancelled = true;
      // Destroying the loading task also destroys the document + its worker port.
      void task?.destroy();
    };
  }, [url, name]);

  if (state.status === "loading") return <PreviewLoading label="Loading PDF…" />;
  if (state.status === "error") return <PreviewMessage name={name} message={state.message} />;
  if (state.status === "password") {
    return <PasswordPrompt name={name} incorrect={state.incorrect} onSubmit={state.submit} />;
  }
  return <PdfPages key={url} doc={state.doc} aspect={state.aspect} />;
}

function PasswordPrompt({ name, incorrect, onSubmit }: { name: string; incorrect: boolean; onSubmit: (pw: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="h-full min-h-[200px] flex flex-col items-center justify-center gap-3 p-6 text-center"
      onSubmit={(e) => { e.preventDefault(); if (value) onSubmit(value); }}
    >
      <Lock className="w-10 h-10 text-neutral-500 dark:text-neutral-400" />
      <div className="text-sm text-neutral-800 dark:text-neutral-200 max-w-xs truncate" title={name}>{name}</div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">This PDF is password-protected.</p>
      <div className="flex gap-2 w-full max-w-xs">
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Password"
          aria-label="PDF password"
          className="flex-1 min-w-0 h-9 px-3 rounded-md border border-neutral-200 dark:border-neutral-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={!value} className="h-9 px-3 rounded-md bg-blue-500 text-white text-sm disabled:opacity-50">
          Open
        </button>
      </div>
      {incorrect && <p className="text-xs text-red-600">Incorrect password. Try again.</p>}
    </form>
  );
}

function PdfPages({ doc, aspect }: { doc: PDFDocumentProxy; aspect: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());

  // Fit-to-width tracks the panel (desktop resize, mobile rotation).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitWidth(Math.max(100, el.clientWidth - PAD * 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only pages near the viewport hold a canvas: a 300-page scan would
  // otherwise allocate gigabytes of bitmaps. Far pages drop back to a
  // placeholder of the right size so the scrollbar stays stable.
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      setVisible((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) next.add(n); else next.delete(n);
        }
        return next;
      });
    }, { root: scrollRef.current, rootMargin: "1200px 0px" });
    setObserver(io);
    return () => io.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const p = pageRefs.current[i];
      if (p && p.offsetTop <= mid) page = i + 1; else if (p) break;
    }
    setCurrent(page);
  }, []);

  // Keep the reading position when zooming: remember the fraction scrolled.
  const applyZoom = (next: number) => {
    const el = scrollRef.current;
    const frac = el && el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
    requestAnimationFrame(() => { if (el) el.scrollTop = frac * el.scrollHeight; });
  };

  const width = Math.round(fitWidth * zoom);
  const btn = "p-1.5 rounded-md text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-800 dark:hover:text-neutral-200 disabled:opacity-40";
  return (
    <div className="h-full flex flex-col bg-neutral-100 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-700 bg-white text-xs text-neutral-500 dark:text-neutral-400">
        <span aria-live="polite">Page {current} / {doc.numPages}</span>
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => applyZoom(zoom / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} title="Zoom out" aria-label="Zoom out"><Minus className="w-4 h-4" /></button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button className={btn} onClick={() => applyZoom(zoom * ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} title="Zoom in" aria-label="Zoom in"><Plus className="w-4 h-4" /></button>
          <button className={btn} onClick={() => applyZoom(1)} disabled={zoom === 1} title="Fit to width" aria-label="Fit to width"><Scan className="w-4 h-4" /></button>
        </div>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto p-3">
        <div className="flex flex-col items-center gap-3" style={{ width: width > fitWidth ? width : undefined }}>
          {fitWidth > 0 && observer && Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              ref={(el) => { pageRefs.current[i] = el; }}
              doc={doc}
              pageNumber={i + 1}
              width={width}
              defaultAspect={aspect}
              active={visible.has(i + 1)}
              observer={observer}
            />
          ))}
        </div>
      </div>
      <PdfTextLayerStyles />
    </div>
  );
}

function PdfPage({
  ref, doc, pageNumber, width, defaultAspect, active, observer,
}: {
  ref: (el: HTMLDivElement | null) => void;
  doc: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  defaultAspect: number;
  active: boolean;
  observer: IntersectionObserver;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [observer]);

  // Fetch page metadata the first time it nears the viewport (its real size
  // replaces the page-1 aspect guess used for the placeholder).
  useEffect(() => {
    if (!active || page) return;
    let cancelled = false;
    doc.getPage(pageNumber).then((p) => { if (!cancelled) setPage(p); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [active, page, doc, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!active || !page || !canvas || !textDiv) return;
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });
    let ratio = window.devicePixelRatio || 1;
    const pixels = viewport.width * viewport.height * ratio * ratio;
    if (pixels > MAX_CANVAS_PIXELS) ratio *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    let renderTask: RenderTask | null = page.render({
      canvas,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    });
    renderTask.promise.catch((e: { name?: string }) => {
      if (e?.name !== "RenderingCancelledException") setFailed(true);
    });

    // Invisible, selectable text over the canvas (copy / find-in-page).
    let textLayer: { cancel: () => void } | null = null;
    textDiv.replaceChildren();
    textDiv.style.setProperty("--total-scale-factor", String(scale));
    void loadPdfJs().then(({ TextLayer }) => {
      if (!renderTask) return;
      const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      textLayer = tl;
      tl.render().catch(() => { /* text is best-effort; the canvas already shows it */ });
    });
    return () => {
      renderTask?.cancel();
      renderTask = null;
      textLayer?.cancel();
    };
  }, [active, page, width]);

  // Drop the bitmap when scrolled far away (a zero-size canvas frees it).
  useEffect(() => {
    if (active) return;
    const c = canvasRef.current;
    if (c) { c.width = 0; c.height = 0; }
    textRef.current?.replaceChildren();
    page?.cleanup();
  }, [active, page]);

  const aspect = page ? page.getViewport({ scale: 1 }).height / page.getViewport({ scale: 1 }).width : defaultAspect;
  return (
    <div
      ref={(el) => { boxRef.current = el; ref(el); }}
      data-page={pageNumber}
      className="pdf-page relative bg-white shadow-md shrink-0"
      style={{ width, height: Math.round(width * aspect) }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-label={`Page ${pageNumber}`} />
      <div ref={textRef} className="textLayer" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
          Page {pageNumber} could not be rendered.
        </div>
      )}
    </div>
  );
}

// Minimal subset of pdfjs-dist/web/pdf_viewer.css for the text layer: runs
// are transparent, absolutely placed, and scaled by --total-scale-factor.
// Scoped under .pdf-page so it can't leak into the rest of the app.
const TEXT_LAYER_CSS = `
.pdf-page{--scale-round-x:1px;--scale-round-y:1px}
.pdf-page .textLayer{position:absolute;inset:0;overflow:clip;line-height:1;text-align:initial;
  -webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:0;
  --min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv:calc(1 / var(--min-font-size))}
.pdf-page .textLayer :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}
.pdf-page .textLayer > :not(.markedContent),.pdf-page .textLayer .markedContent span:not(.markedContent){
  z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));
  --scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.pdf-page .textLayer .markedContent{display:contents}
.pdf-page .textLayer ::selection{background:rgba(26,115,232,.3);color:transparent}
.pdf-page .textLayer br::selection{background:transparent}
`;
function PdfTextLayerStyles() {
  return <style href="file-preview-pdf-text-layer" precedence="default">{TEXT_LAYER_CSS}</style>;
}

export default function PdfPreview({ src }: PreviewProps) {
  return <PdfDocument url={src.url} name={src.name} />;
}
