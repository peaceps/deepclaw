import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration: number; // ms, 0 = manual close
  leaving?: boolean; // store 标记即将移除，组件据此触发退出动画
}

const MAX_TOASTS = 5;
export const EXIT_MS = 200;

type ToastState = {
  toasts: ToastItem[];

  show: (toast: Omit<ToastItem, 'id' | 'duration' | 'leaving'> & { id?: string; duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

let counter = 0;
function genId() {
  counter += 1;
  return `toast-${Date.now()}-${counter}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: ({ id, type = 'info', title, message, duration = 4000 }) => {
    const toastId = id ?? genId();
    const toast: ToastItem = { id: toastId, type, title, message, duration };

    set((state) => {
      const next = [...state.toasts, toast];

      // 超过上限：标记最老的为 leaving，延迟移除（走退出动画）
      const nonLeaving = next.filter((t) => !t.leaving);
      if (nonLeaving.length > MAX_TOASTS) {
        const oldest = nonLeaving[0];
        const idx = next.indexOf(oldest);
        next[idx] = { ...oldest, leaving: true };
        setTimeout(() => get().dismiss(oldest.id), EXIT_MS);
      }

      return { toasts: next };
    });

    return toastId;
  },

  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clear: () => set({ toasts: [] }),
}));

// Convenience helpers (can be called outside React components)
export const toast = {
  success: (message: string, opts?: Partial<Pick<ToastItem, 'title' | 'duration'>>) =>
    useToastStore.getState().show({ type: 'success', message, ...opts }),
  error: (message: string, opts?: Partial<Pick<ToastItem, 'title' | 'duration'>>) =>
    useToastStore.getState().show({ type: 'error', message, duration: 6000, ...opts }),
  warning: (message: string, opts?: Partial<Pick<ToastItem, 'title' | 'duration'>>) =>
    useToastStore.getState().show({ type: 'warning', message, ...opts }),
  info: (message: string, opts?: Partial<Pick<ToastItem, 'title' | 'duration'>>) =>
    useToastStore.getState().show({ type: 'info', message, ...opts }),
};
