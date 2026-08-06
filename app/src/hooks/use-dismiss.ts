"use client";

import { useEffect, type RefObject } from "react";

/**
 * Close a popover on an outside click or Escape.
 *
 * Pass **every** element that counts as "inside" — the trigger AND, when the
 * popover renders through `createPortal`, the portal node. That second ref is
 * the whole reason this hook exists: a portalled popover is not a DOM
 * descendant of its trigger, so a handler that only knows the trigger treats
 * the first mousedown *on the popover* as an outside click. It closes on
 * mousedown and the button's click never arrives — which is exactly how picking
 * a person in the table silently did nothing (docs/notion-projects-spec.md,
 * "재보다 틀렸던 것들").
 *
 *   const trigger = useRef<HTMLDivElement>(null);
 *   const popover = useRef<HTMLDivElement>(null);
 *   useDismiss(open, () => setOpen(false), trigger, popover);
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  ...inside: Array<RefObject<HTMLElement | null>>
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inside.some((r) => r.current?.contains(target))) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
 // A scroll that moves the trigger dismisses too. A portalled popover is
 // `fixed` and repositioned from JS, and JS cannot keep up with a scroll the
 // compositor is already drawing — the panel trails the page and jitters
 // ("관성이 있어서 불편해"). Letting go of the anchor is honest and calm; the
 // panel caps its own height and scrolls INSIDE, so nobody needs to scroll the
 // page to read it. Scrolling within the popover itself is not a dismissal.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && inside.some((r) => r.current?.contains(target))) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
 // capture: scrolls of an inner scroller (the page, a table, the sidebar) do
 // not bubble to document
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
 // refs are stable; the rest-array identity changes every render and would
 // resubscribe endlessly
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
