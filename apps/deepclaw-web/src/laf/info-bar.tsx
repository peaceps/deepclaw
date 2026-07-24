'use client';

import { Lightbulb, X } from 'lucide-react';
import { useState } from 'react';

type InfoBarProps = {
    message: string;
    onClose?: () => void;
};

export function InfoBar({ message, onClose }: InfoBarProps) {
    const [visible, setVisible] = useState(true);

    if (!visible) return null;

    const handleClose = () => {
        setVisible(false);
        onClose?.();
    };

    return (
        <div className={`mb-4 flex items-start gap-2 rounded-lg border
                border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700`}>
            <Lightbulb className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{message}</span>
            <button
                onClick={handleClose}
                className="shrink-0 cursor-pointer text-blue-400 hover:text-blue-600 transition-colors"
                aria-label="Close"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
