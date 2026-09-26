"use client";

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Enter while an IME is composing means "settle this syllable", not "send".
 *
 * Typing a Korean word and pressing Enter once used to post TWICE — first the
 * whole text, then, a millisecond later, just the last syllable (the logged
 * pair is kept as IME_DOUBLE_SEND_EXAMPLE in @/i18n/content/components):
 *
 *   06:28:44.091  <whole word, last syllable still composing>
 *   06:28:44.095  <last syllable>
 *
 * because the keypress arrives as two keydowns. The first carries keyCode 229
 * with `isComposing` true (the IME asking to commit the last syllable); our handler read the
 * field, sent it and cleared it. The IME then wrote the syllable it had been
 * composing back into the now-empty field, and the second keydown — an
 * ordinary Enter — sent that leftover as a second comment. Latin text never
 * composes, so it only ever showed up in Korean (and would in Japanese and
 * Chinese).
 *
 * `isComposing` alone is not quite enough: some IMEs report false on the
 * commit keydown while `compositionend` has not fired yet, so the ref from
 * compositionstart/end backs it up. Spread `imeProps` onto the field and ask
 * `composing(e)` before acting on Enter.
 */
export function useImeGuard() {
  const composing = useRef(false);
  return {
    imeProps: {
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: () => {
        composing.current = false;
      },
    },
    composing: (e: ReactKeyboardEvent) => composing.current || isImeComposing(e),
  };
}

/** The stateless half, for a field that cannot carry the composition props. */
export function isImeComposing(e: ReactKeyboardEvent): boolean {
  const native = e.nativeEvent as KeyboardEvent;
  return native.isComposing || native.keyCode === 229;
}
