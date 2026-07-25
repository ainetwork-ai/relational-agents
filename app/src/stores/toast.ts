import { create } from "zustand";

/** Bottom-left undo toasts (Notion's "Moved to Trash — Undo"): every
 *  destructive action gets a 5s window to take it back (UIUX #88). */
export interface Toast {
  id: number;
  message: string;
  onUndo?: () => void | Promise<void>;
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, opts?: { onUndo?: () => void | Promise<void>; duration?: number }) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, opts) => {
    const id = seq++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, onUndo: opts?.onUndo }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, opts?.duration ?? 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
