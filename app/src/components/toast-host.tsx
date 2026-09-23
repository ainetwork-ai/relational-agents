"use client";

import { useToastStore } from "@/stores/toast";
import { X } from "lucide-react";
import { useT } from "@/i18n/provider";

/** Renders the undo-toast stack bottom-left. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const t = useT();
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="flex items-center gap-3 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm text-white shadow-xl dark:bg-neutral-700"
        >
          <span data-testid="toast-message">{toast.message}</span>
          {toast.onUndo && (
            <button
              data-testid="toast-undo"
              onClick={() => {
                void toast.onUndo?.();
                dismiss(toast.id);
              }}
              className="font-medium text-blue-300 hover:text-blue-200"
            >
              {t("실행 취소")}
            </button>
          )}
          <button
            data-testid="toast-dismiss"
            onClick={() => dismiss(toast.id)}
            aria-label={t("닫기")}
            className="text-neutral-400 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
