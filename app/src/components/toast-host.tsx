"use client";

import { useToastStore } from "@/stores/toast";
import { X } from "lucide-react";

/** Renders the undo-toast stack bottom-left. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm text-white shadow-xl dark:bg-neutral-700"
        >
          <span data-testid="toast-message">{t.message}</span>
          {t.onUndo && (
            <button
              data-testid="toast-undo"
              onClick={() => {
                void t.onUndo?.();
                dismiss(t.id);
              }}
              className="font-medium text-blue-300 hover:text-blue-200"
            >
              Undo
            </button>
          )}
          <button
            data-testid="toast-dismiss"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-neutral-400 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
