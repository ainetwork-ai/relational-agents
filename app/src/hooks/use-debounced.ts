"use client";

import { useEffect, useMemo, useRef } from "react";

/** Debounced dispatcher: `call` schedules, `flush` fires now, `cancel` drops. */
export function useDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number
) {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return useMemo(() => {
    const call = (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), ms);
    };
    const flush = (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      fnRef.current(...args);
    };
    const cancel = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    return { call, flush, cancel };
  }, [ms]);
}
