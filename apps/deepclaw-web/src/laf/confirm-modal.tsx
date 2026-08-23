'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

type ConfirmModalProps = {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
};

/**
 * The question in front of something that cannot be taken back. Escape and the backdrop answer no,
 * which is also what the keyboard lands on: a dialog that opens under the finger already on Enter
 * would otherwise answer itself.
 */
export function ConfirmModal({
    title, message, confirmLabel, cancelLabel, onConfirm, onCancel,
}: ConfirmModalProps) {
    const { t } = useTranslation();

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
    }, [onCancel]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    /**
     * Whoever was focused when this opened is noted before the cancel button takes over, and is
     * handed the focus back on the way out, so a keyboard goes on from where it asked rather than
     * from the top of the page. Nothing is handed back to a button the answer took off the page.
     *
     * Once, on the way in and the way out: the handlers around this are written fresh on every
     * render of the page behind it, and an effect watching them would give the focus back early.
     */
    const opener = useRef<Element | null>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        opener.current = document.activeElement;
        cancelRef.current?.focus();
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
            const back = opener.current;
            if (back instanceof HTMLElement && back.isConnected) {
                back.focus();
            }
        };
    }, []);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 p-4"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-sm rounded-lg bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start gap-3 px-5 pt-5">
                    <span className="mt-0.5 flex-shrink-0 text-red-500"><AlertTriangle size={20} /></span>
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                        <p className="mt-1 text-sm text-gray-600 break-words">{message}</p>
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-5 py-4">
                    <button
                        ref={cancelRef}
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300
                            rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                        {cancelLabel ?? t('web.common.cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 rounded-md
                            hover:bg-red-600 transition-colors cursor-pointer"
                    >
                        {confirmLabel ?? t('web.common.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
