"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun, Monitor } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";
type Mode = ThemeMode;

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getMode(): Mode {
  try {
    const v = localStorage.getItem("notion-theme");
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(mode: Mode) {
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setThemeMode(mode: Mode) {
  try {
    localStorage.setItem("notion-theme", mode);
  } catch {}
  apply(mode);
  listeners.forEach((l) => l());
}

/** Current theme mode, live-updating across every mounted control. */
export function useThemeMode(): Mode {
  return useSyncExternalStore(subscribe, getMode, () => "system" as Mode);
}

/** Notion-style theme control: Light → Dark → System (follow the OS). */
export function DarkModeToggle() {
  const mode = useThemeMode();

  // in System mode, follow live OS theme changes
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);

  return (
    <button
      data-testid="dark-mode-toggle"
      data-theme-mode={mode}
      onClick={() => {
        // from System, jump to the OPPOSITE of the effective theme so the
        // click always produces a visible change; then Light→Dark→System
        const target: Mode =
          mode === "light"
            ? "dark"
            : mode === "dark"
              ? "system"
              : document.documentElement.classList.contains("dark")
                ? "light"
                : "dark";
        setThemeMode(target);
      }}
      className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
      aria-label={`Theme: ${mode}`}
      data-tip={`Theme: ${mode}`}
    >
      {mode === "dark" ? <Sun size={15} /> : mode === "light" ? <Moon size={15} /> : <Monitor size={15} />}
    </button>
  );
}
