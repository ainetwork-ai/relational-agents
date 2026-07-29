"use client";

import { Menu } from "lucide-react";
import { useUiStore } from "@/stores/ui";

/** Mobile-only hamburger that opens the sidebar drawer. Hidden on md+. */
export function MobileNavToggle() {
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  return (
    <button
      data-testid="mobile-nav-toggle"
      onClick={() => setMobileNavOpen(true)}
      className="fixed left-2 top-2 z-30 rounded-md bg-white/70 p-2 text-neutral-500 shadow-sm backdrop-blur transition-colors hover:bg-neutral-100 md:hidden dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-700"
      aria-label="Open menu"
    >
      <Menu size={18} />
    </button>
  );
}
