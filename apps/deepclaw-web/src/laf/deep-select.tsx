'use client';
import {ChangeEvent} from 'react';

type DeepSelectProps = {
    label: string;
    value?: string;
    options: {value: string; label: string}[];
    onSelect: (e: ChangeEvent<HTMLSelectElement, HTMLSelectElement>) => void;
    error?: string;
}

export function DeepSelect({
    label,
    value,
    options,
    onSelect,
    error
}: DeepSelectProps) {

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
            <select
                value={value || ''}
                onChange={onSelect}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                error ? 'border-red-500 bg-red-50' : 'border-gray-300'
                }`}
            >
                <option value="" disabled hidden></option>
                {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
    )
}
