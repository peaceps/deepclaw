'use client'

import { useEffect, useCallback } from 'react';
import { X } from "lucide-react";
import { Markdown } from "./markdown";

type ModalContentType = {
    type: 'text' | 'markdown';
    title: string;
    content: string;
    onClose: () => void
}

export function ContentModal({ type, title, content, onClose }: ModalContentType) {
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={onClose}
        >
            <div
                className="relative bg-white rounded-lg shadow-xl flex flex-col"
                style={{ width: '50vw', height: '50vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                    <span className="text-sm font-medium text-gray-700">{title}</span>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-y-auto px-4 py-3">
                    {type === 'text' ? <pre className="text-[13px] text-gray-800 whitespace-pre-wrap break-words font-mono">
                        {content}
                    </pre> : <Markdown content={content}></Markdown>}
                </div>
            </div>
        </div>
    );
}
