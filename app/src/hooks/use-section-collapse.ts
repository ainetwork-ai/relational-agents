"use client";

import { useEffect, useState } from "react";

const KEY = "sidebar-collapsed-sections";

function readAll(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Collapsible sidebar sections with remembered state. */
export function useSectionCollapse(name: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
 // deferred so no setState runs synchronously in the effect body
    void Promise.resolve().then(() => setCollapsed(!!readAll()[name]));
  }, [name]);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [name]: next }));
      } catch {}
      return next;
    });
  };
  return [collapsed, toggle];
}
