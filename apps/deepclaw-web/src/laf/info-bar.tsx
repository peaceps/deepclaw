'use client';

import { Lightbulb } from 'lucide-react';

type InfoBarProps = {
    message: string;
};

export function InfoBar({ message }: InfoBarProps) {
    return (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <Lightbulb className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{message}</span>
        </div>
    );
}
