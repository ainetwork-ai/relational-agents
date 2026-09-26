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
 * "Things we got wrong after measuring").
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
      // A layer opened FROM INSIDE this popover (a ⋯ menu, a confirm dialog) is
      // portalled to <body> too, so it is not inside any ref we were given — and
      // a mousedown on it read as "outside": the popover closed, unmounting the
      // component that owned the menu, and the click never arrived. That is how
      // Delete in the table's comment card did nothing. Such layers carry
      // data-dismiss-layer; a press on one is not a press outside us.
      if (target instanceof Element && target.closest("[data-dismiss-layer]")) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
 // one Escape closes ONE layer: this popover, not the peek or modal under it.
 // Capture phase, so the surface's own document listener (registered earlier,
 // and so ahead of us in the bubble order) sees defaultPrevented and stays.
      e.preventDefault();
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
 // refs are stable; the rest-array identity changes every render and would
 // resubscribe endlessly
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss]);
}
