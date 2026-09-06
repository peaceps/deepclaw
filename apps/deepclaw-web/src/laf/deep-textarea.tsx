'use client';
import {ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {AgentInteractionEvent} from '@deepclaw/core';

type DeepTextareaProps = {
    uiInfo: Extract<AgentInteractionEvent, {type: 'input'}>;
    value?: string;
    onInput: (e: ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    rows?: number;
    maxLength?: number;
}

/**
 * A field for what runs past a line: a paragraph is typed as a paragraph, and the box grows by the
 * corner where one is not enough. Everything else is the single-line field, so the two sit under
 * each other in a form without a seam.
 */
export function DeepTextarea({
    uiInfo,
    value,
    onInput,
    placeholder,
    rows = 4,
    maxLength
}: DeepTextareaProps) {
    const {t} = useTranslation();

    return (
        <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
            {t(uiInfo.content)}
        </label>
        <textarea
            value={value}
            onChange={onInput}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500
                       focus:border-blue-500 outline-none transition-colors resize-y"
        />
        {/* The box stops taking characters at the limit, and this is what says why it stopped. */}
        {maxLength ? <p className="mt-1 text-xs text-gray-400 text-right">
            {value?.length || 0} / {maxLength}
        </p> : null}
        </div>
    )
}
