'use client';
import {ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {AgentInteractionEvent} from '@deepclaw/core';

type DeepSelectProps = {
    uiInfo: Extract<AgentInteractionEvent, {type: 'select'}>;
    value?: string;
    onSelect: (e: ChangeEvent<HTMLSelectElement, HTMLSelectElement>) => void;
    error?: boolean;
    Icon?: React.ComponentType<{ size?: number; className?: string, children?: React.ReactNode }>;
    iconTitle?: string;
}

export function DeepSelect({
    uiInfo,
    value,
    onSelect,
    error,
    Icon,
    iconTitle
}: DeepSelectProps) {
    const {t} = useTranslation();

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
                {Icon && iconTitle && <Icon size={16} className="mr-2 mb-1 text-yellow-500 inline">
                    <title>{t(iconTitle)}</title>
                </Icon>}{t(uiInfo.content)}
            </label>
            <select
                value={value || ''}
                onChange={onSelect}
                className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                    outline-none transition-colors ${error ? 'border-red-500 bg-red-50' : 'border-gray-300'}`
                }
            >
                <option value="" disabled hidden></option>
                {uiInfo.options.map((opt) => {
                    const [l, v] = typeof opt === 'string' ? [opt, opt] : [opt.label, opt.value.toString()];
                    return <option key={v} value={v}>{t(l)}</option>
                })}
            </select>
            {error && <p className="mt-1 text-xs text-red-600">{t('web.config.error.select', {name: t(uiInfo.content)})}</p>}
        </div>
    )
}
