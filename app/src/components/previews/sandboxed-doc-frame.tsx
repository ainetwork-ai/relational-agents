"use client";
// Script-less iframe that Office renderers (docx, pptx) draw into.
//
// Their HTML is built from untrusted XML: hyperlinks can be `javascript:`,
// text can carry markup. The frame is sandboxed WITHOUT allow-scripts, so
// nothing inside can execute; allow-same-origin only lets this (parent) code
// reach `contentDocument` to render into it. Popups are allowed so a vetted
// http(s)/mailto link can open in a new tab, escaping the sandbox there.
import { useEffect, useRef, useState } from "react";
import { PreviewLoading, PreviewMessage } from "./status";

const SAFE_HREF = /^(https?:|mailto:)/i;
const XLINK = "http://www.w3.org/1999/xlink";

/** Keep only http(s)/mailto links, always opening in a new, unlinked tab. */
function sanitizeLinks(root: ParentNode) {
  // Only write when a value differs: this runs from a MutationObserver that
  // watches href, and a same-value write would still re-trigger it.
  const set = (el: Element, k: string, v: string) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  root.querySelectorAll("a, area").forEach((a) => {
    const href = (a.getAttribute("href") ?? a.getAttributeNS(XLINK, "href") ?? "").trim();
    if (a.hasAttributeNS(XLINK, "href")) a.removeAttributeNS(XLINK, "href");
    if (SAFE_HREF.test(href)) {
      set(a, "href", href);
      set(a, "target", "_blank");
      set(a, "rel", "noopener noreferrer");
    } else {
      if (a.hasAttribute("href")) a.removeAttribute("href");
      if (a.hasAttribute("target")) a.removeAttribute("target");
    }
  });
}

// Neutral canvas: grey desk behind white pages, like Drive's viewer.
const BASE_CSS = `
html,body{margin:0;background:#f1f3f4;}
body{padding:12px 0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans KR",sans-serif;}
a[href]{cursor:pointer;}
`;

export type SandboxedDocFrameProps = {
  /** File name — for the iframe title and the error state. */
  name: string;
  /** Draw the document into the frame's `doc.body`. Runs once per mount. */
  render: (doc: Document) => Promise<void>;
  /** Re-fit content to the frame's width (called after render and on resize). */
  fit?: (doc: Document, width: number) => void;
  /** Extra CSS the renderer needs inside the frame. */
  css?: string;
};

export function SandboxedDocFrame({ name, render, fit, css = "" }: SandboxedDocFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<{ status: "rendering" } | { status: "ready" } | { status: "error"; message: string }>({ status: "rendering" });
  // Latest callbacks without re-running the render effect.
  const fitRef = useRef(fit);
  const renderRef = useRef(render);
  useEffect(() => { fitRef.current = fit; renderRef.current = render; });

  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!loaded || !frame || !doc) return;
    let cancelled = false;
    // Links can appear after the first pass (async sub-renders, charts).
    const mo = new MutationObserver(() => sanitizeLinks(doc));
    const refit = () => fitRef.current?.(doc, frame.clientWidth);
    const ro = new ResizeObserver(refit);
    renderRef.current(doc).then(
      () => {
        if (cancelled) return;
        sanitizeLinks(doc);
        mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
        refit();
        ro.observe(frame);
        setState({ status: "ready" });
      },
      (e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : "Could not render this file." });
      },
    );
    return () => { cancelled = true; mo.disconnect(); ro.disconnect(); };
  }, [loaded]);

  if (state.status === "error") return <PreviewMessage name={name} message={state.message} />;
  return (
    <div className="relative h-full min-h-[300px]">
      <iframe
        ref={frameRef}
        title={name}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body></body></html>`}
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full border-0 block bg-[#f1f3f4]"
      />
      {state.status === "rendering" && (
        <div className="absolute inset-0 bg-white"><PreviewLoading label="Rendering…" /></div>
      )}
    </div>
  );
}
