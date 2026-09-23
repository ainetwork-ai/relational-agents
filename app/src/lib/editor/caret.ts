"use client";

/** Caret offset within an element, measured in innerText characters. */
export function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Place the caret at a character offset (or the end) of an element. */
export function setCaret(el: HTMLElement, pos: number | "start" | "end") {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  if (pos === "start") {
    range.selectNodeContents(el);
    range.collapse(true);
  } else if (pos === "end") {
    range.selectNodeContents(el);
    range.collapse(false);
  } else {
    let remaining = pos;
    let placed = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Viewport rect of the caret, for anchoring popovers and for keeping the x
 * across a vertical move. A collapsed range anchored on an *element* (what
 * selectNodeContents+collapse leaves behind) has no client rect in Chrome —
 * measure the neighbouring character instead, or the caret reads as x=0. */
export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];

  const { startContainer: node, startOffset: off } = range;
  const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "") : null;
  if (text) {
    const probe = range.cloneRange();
    if (off > 0) {
      probe.setStart(node, off - 1);
      probe.setEnd(node, off);
      const r = probe.getBoundingClientRect();
      if (r.width || r.height) return new DOMRect(r.right, r.top, 0, r.height);
    }
    if (off < text.length) {
      probe.setStart(node, off);
      probe.setEnd(node, off + 1);
      const r = probe.getBoundingClientRect();
      if (r.width || r.height) return new DOMRect(r.left, r.top, 0, r.height);
    }
  }
 // element-anchored caret: measure the child the caret sits after/before
  if (node instanceof HTMLElement || node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const probe = document.createRange();
    probe.selectNodeContents(el);
    const lines = [...probe.getClientRects()].filter((r) => r.width || r.height);
    if (lines.length) {
      const last = lines[lines.length - 1];
      const first = lines[0];
      const atEnd = off >= el.childNodes.length;
      return atEnd
        ? new DOMRect(last.right, last.top, 0, last.height)
        : new DOMRect(first.left, first.top, 0, first.height);
    }
  }
  const el =
    node instanceof HTMLElement ? node : node.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

/** The visual line boxes of an element's own text, top to bottom.
 * A wrapped table cell has one rect per line — that is how we tell whether a
 * vertical arrow still has a line to go to inside the cell. */
export function lineRects(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  const lines: DOMRect[] = [];
  for (const r of rects) {
    const same = lines.find((l) => Math.abs(l.top - r.top) < 2);
    if (!same) lines.push(r);
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** Is the caret on the element's first / last visual line?
 * An empty element counts as both — there is no line to move to. */
export function caretOnEdgeLine(el: HTMLElement, edge: "first" | "last"): boolean {
  const lines = lineRects(el);
  if (lines.length <= 1) return true;
  const caret = caretRect();
  if (!caret) return true;
  const line = edge === "first" ? lines[0] : lines[lines.length - 1];
  return Math.abs(caret.top - line.top) < 3;
}

/** Place the caret on an element's first/last visual line, at the x nearest to
 * `x` — what a vertical arrow does when it lands in another cell. */
export function setCaretAtX(el: HTMLElement, x: number, edge: "first" | "last") {
  el.focus();
  const lines = lineRects(el);
  const line = edge === "first" ? lines[0] : lines[lines.length - 1];
  if (!line) {
    setCaret(el, "start");
    return;
  }
  const y = line.top + line.height / 2;
  const clamped = Math.min(Math.max(x, line.left + 0.5), line.right - 0.5);
 // caretRangeFromPoint is Chrome/Safari; caretPositionFromPoint is the standard
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = doc.caretRangeFromPoint?.(clamped, y) ?? null;
  const pos = range ? null : doc.caretPositionFromPoint?.(clamped, y) ?? null;
  const sel = window.getSelection();
  if (!sel) return;
  if (range && el.contains(range.startContainer)) {
    sel.removeAllRanges();
    sel.addRange(range);
  } else if (pos && el.contains(pos.offsetNode)) {
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    setCaret(el, edge === "first" ? "start" : "end");
  }
}
