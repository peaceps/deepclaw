'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalStore } from '@/lib/modal-store';
import type { AgentInteractionEventOption } from '@deepclaw/core';
import { Send, Check } from 'lucide-react';

function isValueEmpty(input: string): boolean {
    return input.trim() === '';
}

export function InteractionModal() {
  const { t } = useTranslation();
  const { visible, event, instanceId, closeModal } = useModalStore();

  if (!visible || !event) return null;

  return <ModalContent key={instanceId} event={event} onClose={closeModal} t={t} />;
}

function ModalContent({ event, onClose, t }: {
  event: NonNullable<ReturnType<typeof useModalStore.getState>['event']>;
  onClose: (answer: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [inputValue, setInputValue] = useState('');
  const [selectedValue, setSelectedValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (event.type === 'input') {
      inputRef.current?.focus();
    }
  }, [event.type]);

  const handleSubmit = useCallback(() => {
    if (event.type === 'input') {
      if (!isValueEmpty(inputValue)) {
        onClose(inputValue);
      }
    } else if (event.type === 'select') {
      onClose(selectedValue);
    } else {
      onClose('');
    }
  }, [event, inputValue, selectedValue, onClose]);

  const isReadonly = event.type === 'readonly';
  const isInput = event.type === 'input';
  const isSelect = event.type === 'select';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{event.content}</h3>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {isReadonly && (
            <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
              {event.content}
            </p>
          )}

          {isInput && (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isValueEmpty(inputValue)) handleSubmit();
              }}
              className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          )}

          {isSelect && (
            <div className="space-y-2">
              {event.options.map((opt: AgentInteractionEventOption, index: number) => {
                const [label, value] = typeof opt === 'string' ? [opt, opt] : [opt.label, opt.value];
                const isSelected = selectedValue === value;
                const optionClass = isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50';
                return (
                  <button
                    key={index}
                    onClick={() => setSelectedValue(value)}
                    className={'w-full flex items-center justify-between px-4 py-2.5 rounded-lg border transition-colors text-left ' + optionClass}
                  >
                    <span className="text-sm">{label}</span>
                    {isSelected && <Check size={18} className="text-blue-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isReadonly && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            {isInput && (
              <button
                onClick={handleSubmit}
                disabled={isValueEmpty(inputValue)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded-lg transition-colors"
              >
                <Send size={16} />
                {t('web.common.send')}
              </button>
            )}
            {isSelect && (
              <button
                onClick={handleSubmit}
                disabled={!selectedValue}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded-lg transition-colors"
              >
                <Check size={16} />
                {t('web.common.confirm')}
              </button>
            )}
          </div>
        )}

        {isReadonly && (
          <div className="flex justify-end px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => onClose('')}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {t('web.common.ok')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
