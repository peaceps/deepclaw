'use client'

import { useCallback, useEffect, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * How much of the page it takes before anybody maximizes it. `half` is a thing to read: a report,
 * a file, one piece the page stepped aside for. `tall` is a thing to look through, where what is
 * below the fold is the point and half a screen of it is not a list.
 */
type ModalSize = 'half' | 'tall';

const SIZES: Record<ModalSize, string> = {
    half: 'w-[90vw] h-[80vh] md:w-[50vw] md:h-[50vh]',
    tall: 'w-[90vw] h-[85vh] md:w-[70vw]',
};

type ModalProps = {
    title: string;
    size?: ModalSize;
    /**
     * What the caller offers in the corner, beside the two buttons every panel has. It sits with
     * them rather than in the footer because what belongs here is done to the thing being read --
     * a report edited, a list filtered -- and the footer is where the panel is finished with.
     */
    actions?: React.ReactNode;
    /**
     * Whether a click on the dark behind the panel is a way out of it, which it is unless what the
     * panel holds would be missed. A box being written in is minutes of the user's work and the
     * backdrop is the easiest of the three ways out to hit by accident, so a caller with one open
     * takes it off and leaves the two that are aimed at.
     */
    closeOnBackdrop?: boolean;
    footer?: React.ReactNode;
    onClose: () => void;
    children: React.ReactNode;
};

/**
 * The panel a page opens in front of itself. What is in it belongs to whoever opened it; the frame
 * around it is the same every time -- the size, the heading, the way out, the page held still
 * behind it -- which is the whole reason this is one component and not a shape each caller draws.
 *
 * The body is handed over as it is, without padding or a scrollbar of its own: a report scrolls
 * whole, while a list has a bar across the top that stays put while the rows under it move, and
 * only the caller knows which it is. What it gets is the room left over, and no more than that.
 */
export function Modal(
    {
        title, size = 'half', actions, closeOnBackdrop = true, footer, onClose, children
    }: ModalProps
) {
    const [maximized, setMaximized] = useState(false);
    const { t } = useTranslation();

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [handleKeyDown]);

    // Above the toasts, and under the question of a loop, which is the one thing worth interrupting for.
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 cursor-default"
            onClick={closeOnBackdrop ? onClose : undefined}
        >
            <div
                className={`relative bg-white rounded-lg shadow-xl flex flex-col
                    transition-[width,height] ${maximized ? 'w-[90vw] h-[90vh]' : SIZES[size]}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <span className="text-base font-semibold text-gray-900 truncate pr-2">{title}</span>
                    <div className="flex items-center gap-3 text-gray-400">
                        {actions}
                        <button
                            onClick={() => setMaximized(!maximized)}
                            title={t(`web.common.${maximized ? 'restore' : 'maximize'}`)}
                            className="hover:text-gray-600 transition-colors"
                        >
                            {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <button
                            onClick={onClose}
                            className="hover:text-gray-600 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                    {children}
                </div>
                {footer && <div className={`flex justify-end items-center gap-2 px-4 py-3
                    border-t border-gray-200`}>
                    {footer}
                </div>}
            </div>
        </div>
    );
}
