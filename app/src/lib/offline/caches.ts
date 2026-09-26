/**
 * Empties what the service worker keeps (public/sw.js) — on logout, so the
 * next person on this browser does not open the last one's pages offline.
 * Deletes the caches from the page as well, in case no worker is running.
 */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const sw = navigator.serviceWorker?.controller;
    if (sw) {
      await new Promise<void>((resolve) => {
        const ch = new MessageChannel();
        const timer = setTimeout(resolve, 1000);
        ch.port1.onmessage = () => {
          clearTimeout(timer);
          resolve();
        };
        sw.postMessage({ type: "clear" }, [ch.port2]);
      });
    }
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {}
}
