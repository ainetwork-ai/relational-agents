import type { ReactNode } from "react";

/** Page icons are either an emoji string or an image URL (uploaded / external). */
export function isImageIcon(icon: string | null | undefined): icon is string {
  return (
    !!icon &&
    (icon.startsWith("/") ||
      icon.startsWith("http://") ||
      icon.startsWith("https://") ||
      icon.startsWith("data:image/"))
  );
}

/** Renders a page icon inline: <img> for URL icons, the emoji text otherwise.
 *  No hooks — safe in both server and client components. `className` sizes the
 *  img; the default tracks the surrounding font size like an emoji would. */
export function PageIcon({
  icon,
  fallback = null,
  className = "inline-block h-[1em] w-[1em] rounded-sm object-cover align-[-0.1em]",
}: {
  icon: string | null | undefined;
  fallback?: ReactNode;
  className?: string;
}) {
  if (isImageIcon(icon)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={className} />;
  }
  return <>{icon ?? fallback}</>;
}
