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

/** Viewport rect of the caret, for anchoring popovers. */
export function caretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[0];
 // empty element fallback: use the element's rect
  const el =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
  return el ? el.getBoundingClientRect() : null;
}
