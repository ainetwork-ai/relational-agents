import { forgetDevices } from "@/lib/willow/device";

/**
 * Empties what this browser keeps for the signed-in person — on logout, and when
 * someone else signs in (review I1/I2): the service worker's caches (public/sw.js),
 * and the Willow signing keys and certificates (lib/willow/device), so the next
 * person can neither open the last one's pages offline nor sign as their device.
 * Unsent edits stay in IndexedDB; only their own user replays or sends them.
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
  await forgetDevices();
}
