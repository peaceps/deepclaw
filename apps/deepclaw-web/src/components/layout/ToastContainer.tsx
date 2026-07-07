'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useToastStore, EXIT_MS, type ToastItem, type ToastType } from '@/lib/toast-store';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const ICONS: Record<ToastType, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastType, string> = {
  success: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/80 text-green-800 dark:text-green-200',
  error: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/80 text-red-800 dark:text-red-200',
  warning: 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200',
  info: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200',
};

const ICON_COLORS: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = ICONS[toast.type];

  const triggerDismiss = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    exitTimerRef.current = setTimeout(() => onDismiss(toast.id), EXIT_MS);
  }, [onDismiss, toast.id]);

  // store 标记 leaving（超限被挤掉时），触发退出动画
  useEffect(() => {
    if (toast.leaving && !leavingRef.current) {
      triggerDismiss();
    }
  }, [toast.leaving, triggerDismiss]);

  // 自动消失：组件自己管 timer，到点先走退出动画再移除
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(triggerDismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, triggerDismiss]);

  // 卸载时清理退出动画 timer
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  return (
    <div
      className={[
        'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-lg',
        'transition-all duration-200',
        leaving
          ? 'opacity-0 translate-x-4'
          : 'opacity-100 translate-x-0 animate-[toast-slide-in_0.2s_ease-out]',
        STYLES[toast.type],
      ].join(' ')}
    >
      <Icon size={20} className={`shrink-0 mt-0.5 ${ICON_COLORS[toast.type]}`} />

      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-semibold mb-0.5">{toast.title}</p>
        )}
        <p className="text-sm break-words whitespace-pre-wrap">{toast.message}</p>
      </div>

      <button
        onClick={triggerDismiss}
        className="shrink-0 p-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        aria-label="close"
      >
        <X size={16} className="opacity-60" />
      </button>
    </div>
  );
}
