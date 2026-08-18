'use client'

import { useEffect, useCallback, useState } from 'react';
import { Maximize2, Minimize2, X } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { Markdown } from "./markdown";

type ModalContentType = {
    type: 'text' | 'markdown';
    title: string;
    content: string;
    footer?: React.ReactNode;
    onClose: () => void
}

export function ContentModal(
    { type, title, content, footer, onClose }: ModalContentType
) {
    const [maximized, setMaximized] = useState(false);
    const {t} = useTranslation();

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

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 cursor-default"
            onClick={onClose}
        >
            <div
                className={`relative bg-white rounded-lg shadow-xl flex flex-col transition-[width,height] ${
                    maximized ? 'w-[90vw] h-[90vh]' : 'w-[90vw] h-[80vh] md:w-[50vw] md:h-[50vh]'}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <span className="text-base font-semibold text-gray-900 truncate pr-2">{title}</span>
                    <div className="flex items-center gap-3 text-gray-400">
                        <button
                            onClick={() => setMaximized(!maximized)}
                            title={t(`web.common.${maximized ? 'restore' : 'maximize'}`)}
                            className="hover:text-gray-600 transition-colors cursor-pointer"
                        >
                            {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <button
                            onClick={onClose}
                            className="hover:text-gray-600 transition-colors cursor-pointer"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-y-auto px-4 py-3">
                    {type === 'text' ? <pre className="text-[13px] text-gray-800 whitespace-pre-wrap break-words font-mono">
                        {content}
                    </pre> : <Markdown content={content}></Markdown>}
                </div>
                {/* Footer */}
                {footer && <div className={`flex justify-end items-center gap-2 px-4 py-3
                    border-t border-gray-200`}>
                    {footer}
                </div>}
            </div>
        </div>
    );
}
