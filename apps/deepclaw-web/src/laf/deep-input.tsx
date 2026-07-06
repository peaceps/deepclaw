'use client';
import {ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {AgentInteractionEvent} from '@deepclaw/core';

type DeepInputProps = {
    uiInfo: Extract<AgentInteractionEvent, {type: 'input'}>;
    value?: string;
    onInput: (e: ChangeEvent<HTMLInputElement, HTMLInputElement>) => void;
    placeholder?: string;
    error?: boolean;
    Icon?: React.ComponentType<{ size?: number; className?: string, children?: React.ReactNode }>;
    iconTitle?: string;
}

export function DeepInput({
    uiInfo,
    value,
    onInput,
    placeholder,
    error,
    Icon,
    iconTitle
}: DeepInputProps) {
    const {t} = useTranslation();

    return (
        <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
            {Icon && iconTitle && <Icon size={16} className="mr-2 mb-1 text-yellow-500 inline">
                <title>{t(iconTitle)}</title>
            </Icon>}{t(uiInfo.content)}
        </label>
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
            <p className="mt-1 text-xs text-red-600">{t('web.config.error.input', {name: t(uiInfo.content)})}</p>
        )}
        </div>
    )
}
