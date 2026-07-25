"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface NotifPrefs {
  enabled: boolean;
  sound: boolean;
  dndUntil: string | null;
}

/** Notification settings panel (mock): on/off, sound, and DND as in-app state only. */
export function NotifSettings({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);

  async function load() {
    const res = await fetch("/api/ai/notif-prefs");
    if (!res.ok) return;
    setPrefs(await res.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(body: Partial<NotifPrefs>) {
    const res = await fetch("/api/ai/notif-prefs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setPrefs(await res.json());
  }

  const dndOn = !!prefs?.dndUntil;

  return (
    <div
      data-testid="notif-settings"
      className="absolute right-4 top-12 z-20 w-64 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-[#252525]"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Notifications</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          <X size={14} />
        </button>
      </div>
      {prefs && (
        <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
          <label className="flex items-center justify-between">
            Enable notifications
            <input
              type="checkbox"
              data-testid="notif-enabled-toggle"
              checked={prefs.enabled}
              onChange={(e) => void patch({ enabled: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between">
            Sound
            <input
              type="checkbox"
              data-testid="notif-sound-toggle"
              checked={prefs.sound}
              onChange={(e) => void patch({ sound: e.target.checked })}
            />
          </label>
          <label className="flex items-center justify-between">
            Do not disturb
            <input
              type="checkbox"
              data-testid="notif-dnd-toggle"
              checked={dndOn}
              onChange={(e) =>
                void patch({
                  dndUntil: e.target.checked
                    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    : null,
                })
              }
            />
          </label>
          <p data-testid="notif-dnd-status" className="text-xs text-neutral-400">
            {dndOn && prefs.dndUntil
              ? `Do not disturb until ${new Date(prefs.dndUntil).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Do not disturb is off"}
          </p>
        </div>
      )}
    </div>
  );
}
