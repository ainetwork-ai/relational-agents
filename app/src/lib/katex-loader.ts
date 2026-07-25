/** Lazy loader for the vendored KaTeX dist (public/katex — pnpm store is
 * broken on this host, so the package is served as static assets). */

declare global {
  interface Window {
    katex?: { renderToString: (tex: string, opts?: object) => string };
  }
}

let loading: Promise<void> | null = null;

export function ensureKatex(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.katex) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[href="/katex/katex.min.css"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/katex/katex.min.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "/katex/katex.min.js";
    js.onload = () => resolve();
    js.onerror = () => reject(new Error("katex load failed"));
    document.head.appendChild(js);
  });
  return loading;
}

/** Render TeX to HTML (display mode), '' until KaTeX is loaded. */
export function renderTex(tex: string): string {
  if (typeof window === "undefined" || !window.katex) return "";
  try {
    return window.katex.renderToString(tex, { displayMode: true, throwOnError: false });
  } catch {
    return "";
  }
}

/** Render TeX inline (no display mode), '' until KaTeX is loaded. */
export function renderTexInline(tex: string): string {
  if (typeof window === "undefined" || !window.katex) return "";
  try {
    return window.katex.renderToString(tex, { displayMode: false, throwOnError: false });
  } catch {
    return "";
  }
}
