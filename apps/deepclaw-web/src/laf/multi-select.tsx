'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export type MultiSelectOption = {
    id: string;
    label: string;
};

type MultiSelectProps = {
    options: MultiSelectOption[];
    selected: Set<string>;
    onToggle: (id: string) => void;
    onResetAll: () => void;
    resetLabel: string;
    emptyLabel?: string;
};

export function MultiSelect({
    options,
    selected,
    onToggle,
    onResetAll,
    resetLabel,
    emptyLabel = '—',
}: MultiSelectProps) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const isAll = selected.size === options.length;

    const toggle = () => {
        if (!open && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        }
        setOpen(v => !v);
    };

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                ref.current && !ref.current.contains(target) &&
                menuRef.current && !menuRef.current.contains(target)
            ) {
                setOpen(false);
            }
        };
        const close = () => setOpen(false);
        document.addEventListener('mousedown', handler);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', handler);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [open]);

    const selectedNames = options
        .filter(o => selected.has(o.id))
        .map(o => o.label);

    const label = isAll
        ? resetLabel
        : selectedNames.length === 0
            ? emptyLabel
            : selectedNames.length <= 2
                ? selectedNames.join(', ')
                : `${selectedNames.length} / ${options.length}`;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={toggle}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:border-gray-400 transition-colors min-w-[120px] justify-between"
            >
                <span className="truncate text-gray-700">{label}</span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            </button>
            {open && pos && createPortal(
                <div
                    ref={menuRef}
                    style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 224) }}
                    className="z-50 rounded-md border border-gray-200 bg-white shadow-lg max-h-60 overflow-auto"
                >
                    <button
                        type="button"
                        onClick={onResetAll}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left border-b border-gray-100"
                    >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isAll ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                            {isAll && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className="text-gray-700">{resetLabel}</span>
                    </button>
                    {options.map(option => {
                        const checked = selected.has(option.id);
                        return (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => onToggle(option.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left"
                            >
                                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                                    {checked && <Check className="w-3 h-3 text-white" />}
                                </span>
                                <span className="text-gray-700">{option.label}</span>
                            </button>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
}
