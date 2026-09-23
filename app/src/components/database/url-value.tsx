"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { classifyLink } from "@/lib/app-link";
import { resolveAppUrl } from "@/lib/compat";
import { usePageRef } from "@/lib/use-page-ref";

/** False on the server and during the first client render, true afterwards.
 *  A value that only the browser can finish (a port-relative service URL needs
 *  window.location.hostname) must not differ between those two passes, or
 *  hydration mismatches. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/**
 * A stored `url` value, rendered as what it points at rather than as its raw
 * characters: a page becomes its icon and title, an upload becomes the picture
 * itself. Nobody needs to read a base64url page id, and clicking one should
 * not leave the app.
 *
 * `cell` fits a table row; `page` is the roomier row-page treatment.
 */
export function UrlValue({
  value,
  variant = "cell",
  testid,
}: {
  value: string;
  variant?: "cell" | "page";
  testid: string;
}) {
  const link = classifyLink(value);
  const { ref, loading } = usePageRef(link.kind === "page" ? link.pageId : null);
  const hydrated = useHydrated();
  const card = variant === "page";

  const chip =
    "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800";
  const cardBox =
    "inline-flex min-w-0 max-w-full items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800";

  if (link.kind === "page") {
 // the id is never the label: until the title arrives the row shows a
 // placeholder of the same shape, so nothing jumps when it does
    const title = ref?.title?.trim() || (loading ? "" : "Untitled");
    const icon = ref?.icon || "📄";
    return (
      <Link
        data-testid={`db-url-link-${testid}`}
        href={link.href}
        onClick={(e) => e.stopPropagation()}
        className={card ? cardBox : chip}
        title={title || undefined}
      >
        <span className={card ? "text-xl leading-none" : "shrink-0 text-sm leading-none"}>{icon}</span>
        {title ? (
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${card ? "text-sm font-medium" : "underline decoration-neutral-300 underline-offset-2"}`}>
              {title}
            </span>
            {card && <span className="block text-xs text-neutral-400">Page</span>}
          </span>
        ) : (
          <span className="h-3.5 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        )}
      </Link>
    );
  }

  if (link.kind === "image") {
    return (
      <a
        data-testid={`db-url-link-${testid}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={card ? cardBox : chip}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={link.href}
          alt=""
          className={
            card
              ? "h-16 w-16 shrink-0 rounded-md object-cover"
              : "h-5 w-5 shrink-0 rounded object-cover"
          }
        />
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${card ? "text-sm font-medium" : "text-sm"}`}>
            {link.name || "Image"}
          </span>
          {card && link.name && <span className="block text-xs text-neutral-400">Image</span>}
        </span>
      </a>
    );
  }

  if (link.kind === "file") {
    return (
      <a
        data-testid={`db-url-link-${testid}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={card ? cardBox : chip}
      >
        <span className={card ? "text-xl leading-none" : "shrink-0 text-sm leading-none"}>📎</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${card ? "text-sm font-medium" : "text-sm"}`}>
            {link.name || "File"}
          </span>
          {card && link.name && <span className="block text-xs text-neutral-400">File</span>}
        </span>
      </a>
    );
  }

  if (link.kind === "internal") {
    return (
      <Link
        data-testid={`db-url-link-${testid}`}
        href={link.href}
        onClick={(e) => e.stopPropagation()}
        className={card ? cardBox : chip}
      >
        <span className="truncate text-sm underline decoration-neutral-300 underline-offset-2">
          {link.label}
        </span>
      </Link>
    );
  }

  if (link.kind === "service") {
 // before hydration the raw value is all we can honestly render; once the
 // host is known the link becomes a real, clickable, copyable URL
    const href = hydrated ? resolveAppUrl(link.href) : link.href;
    const label = hydrated ? href.replace(/^https?:\/\//, "") : link.label;
    return (
      <a
        data-testid={`db-url-link-${testid}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="truncate text-sm text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
      >
        {label}
      </a>
    );
  }

  if (link.kind === "external") {
    return (
      <a
        data-testid={`db-url-link-${testid}`}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="truncate text-sm text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
      >
        {link.label}
      </a>
    );
  }

 // no host, no path we can resolve — show the value, do not invent a link
  return (
    <span data-testid={`db-url-text-${testid}`} className="truncate text-sm text-neutral-500">
      {link.label}
    </span>
  );
}
