'use client';
import {ChangeEvent} from 'react';

type DeepInputProps = {
    label: string;
    value?: string;
    onInput: (e: ChangeEvent<HTMLInputElement, HTMLInputElement>) => void;
    placeholder?: string;
    error?: string;
}

export function DeepInput({
    label,
    value,
    onInput,
    placeholder,
    error
}: DeepInputProps) {

    return (
        <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
        <input
            type="text"
            value={value}
            onChange={onInput}
            placeholder={placeholder}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
            error ? 'border-red-500 bg-red-50' : 'border-gray-300'
            }`}
        />
        {error && (
            <p className="mt-1 text-xs text-red-600">{error}</p>
        )}
        </div>
    )
}
