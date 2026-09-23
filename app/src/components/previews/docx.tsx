"use client";
// Word (.docx/.docm/.dotx) via docx-preview, drawn into a script-less
// SandboxedDocFrame. Pages keep their real width (~816px) and are zoomed down
// to fit the panel, like Drive's viewer.
import { useCallback } from "react";
import type { HElement } from "docx-preview";
import type { PreviewProps } from "./types";
import { OfficeBytes } from "./office-password";
import { SandboxedDocFrame } from "./sandboxed-doc-frame";

const CSS = `
.docx-wrapper{background:transparent!important;padding:0 12px!important;}
.docx-wrapper>section.docx{margin-bottom:16px!important;box-shadow:0 1px 3px rgb(15 23 42/.15)!important;}
`;

/**
 * docx-preview's element factory, but creating nodes in the FRAME's document.
 * The default uses the app's global `document`, so nodes would be born in the
 * scripted app realm (e.g. a detached <img> with an event handler) before
 * being moved into the sandbox.
 */
function frameFactory(doc: Document) {
  const h = (elem: HElement | Node | string): Node => {
    if (typeof elem === "string") return doc.createTextNode(elem);
    // Duck-typed: frame nodes aren't `instanceof` the app realm's Node.
    if ("nodeType" in elem) return elem as Node;
    const { ns, tagName, className, style, children, ...props } = elem as HElement;
    if (tagName === "#fragment") {
      const f = doc.createDocumentFragment();
      children?.forEach((c) => f.appendChild(h(c)));
      return f;
    }
    if (tagName === "#comment") return doc.createComment(children ? String(children[0]) : "");
    const el = ns ? doc.createElementNS(ns, tagName) : doc.createElement(tagName);
    if (className) el.setAttribute("class", className);
    if (typeof style === "string") el.setAttribute("style", style);
    else if (style) Object.assign((el as HTMLElement).style, style);
    for (const [k, v] of Object.entries(props)) if (v !== undefined) (el as unknown as Record<string, unknown>)[k] = v;
    children?.forEach((c) => el.appendChild(h(c)));
    return el;
  };
  return h;
}

// Word bullets are often Symbol/Wingdings private-use code points, which
// render as tofu without those fonts. Swap the common ones for Unicode —
// in numbering CSS (list markers) and in text runs.
const SYMBOL_BULLETS: Record<string, string> = { "\uf0b7": "•", "\uf0a7": "▪", "\uf0d8": "➢", "\uf0fc": "✓", "\uf076": "❖", "\uf06e": "■" };
const SYMBOL_RE = new RegExp(`[${Object.keys(SYMBOL_BULLETS).join("")}]`, "g");

function fitPages(doc: Document, width: number) {
  const wrapper = doc.querySelector<HTMLElement>(".docx-wrapper");
  if (!wrapper) return;
  wrapper.style.zoom = "1";
  const pageWidth = Math.max(0, ...Array.from(wrapper.children, (c) => (c as HTMLElement).offsetWidth));
  if (!pageWidth) return;
  wrapper.style.zoom = String(Math.min(1, (width - 24) / pageWidth));
}

function DocxDocument({ name, data }: { name: string; data: ArrayBuffer }) {
  const render = useCallback(async (doc: Document) => {
    const { renderAsync } = await import("docx-preview");
    const styles = doc.createElement("div");
    const body = doc.createElement("div");
    doc.body.append(styles, body);
    await renderAsync(data, body, styles, {
      inWrapper: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      // data: URLs, not blob: URLs minted in the app realm — self-contained.
      useBase64URL: true,
      // altChunks are embedded raw HTML documents; not worth the surface.
      renderAltChunks: false,
      h: frameFactory(doc),
    });
    styles.querySelectorAll("style").forEach((st) => {
      const css = st.textContent ?? "";
      const fixed = css.replace(SYMBOL_RE, (c) => SYMBOL_BULLETS[c]);
      if (fixed !== css) st.textContent = fixed;
    });
    // Same code points typed as text / <w:sym> runs. Text nodes only
    // (nodeValue), so this can never introduce markup.
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue ?? "";
      if (SYMBOL_RE.test(text)) n.nodeValue = text.replace(SYMBOL_RE, (c) => SYMBOL_BULLETS[c]);
      SYMBOL_RE.lastIndex = 0; // global regex + test() is stateful
    }
  }, [data]);
  return <SandboxedDocFrame name={name} render={render} fit={fitPages} css={CSS} />;
}

export default function DocxPreview({ src }: PreviewProps) {
  return <OfficeBytes src={src}>{(data) => <DocxDocument name={src.name} data={data} />}</OfficeBytes>;
}
