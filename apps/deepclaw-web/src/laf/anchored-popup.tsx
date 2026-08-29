'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { popupPlacement, type PopupPlacement } from './popup-placement';

type AnchoredPopupProps = {
    anchorRef: React.RefObject<HTMLElement | null>;
    width: number;
    maxHeight: number;
    onClose: () => void;
    children: React.ReactNode;
};

/**
 * A little panel hung on the thing that opened it, under it or above it by whichever side of the
 * page has room. It goes in a portal because what opens one is usually a card in a column that
 * scrolls its own way, and a panel drawn inside one would be cut off at the edge of it.
 *
 * Every way out of it is the same way out: a click elsewhere, Escape, a scroll or a resize under
 * it. The last two close rather than follow, the placement being read once off the anchor, and a
 * panel left hanging where the anchor no longer is belongs to nothing.
 */
export function AnchoredPopup({ anchorRef, width, maxHeight, onClose, children }: AnchoredPopupProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<PopupPlacement>();

    useEffect(() => {
        if (anchorRef.current) {
            setPlacement(popupPlacement(
                anchorRef.current.getBoundingClientRect(),
                { width: window.innerWidth, height: window.innerHeight },
                { width, maxHeight },
            ));
        }
    }, [anchorRef, width, maxHeight]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as Node;
            if (!panelRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
                onClose();
            }
        };
        // Escape answers a panel the way it answers a dialog: nothing was picked, and it goes away.
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', onClose);
        window.addEventListener('scroll', onClose, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('scroll', onClose, true);
        };
    }, [anchorRef, onClose]);

    if (!placement) return null;

    return createPortal(
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                top: placement.top,
                bottom: placement.bottom,
                left: placement.left,
                width,
                maxHeight: placement.maxHeight,
            }}
            className="z-50 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
        >
            {children}
        </div>,
        document.body
    );
}
