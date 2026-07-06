'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { TraitBadge } from './trait-badge';
import { colorClassMap, DeepColors } from './laf-types';
import { useTranslation } from 'react-i18next';

const DEFAULT_MAX_LABEL_TEXT_LENGTH = 15;
const DEFAULT_MAX_LABEL_COUNT = 10;

type EditableLabelsProps = {
  labels: string[];
  onChange: (labels: string[]) => void;
  color: DeepColors;
  size?: 'normal' | 'small';
  align?: 'start' | 'end';
  placeholder?: string;
  maxLabelTextLength?: number;
  maxLabelCount?: number;
}

export function EditableLabels({
  labels,
  onChange,
  color,
  size = 'normal',
  align = 'start',
  placeholder,
  maxLabelTextLength = DEFAULT_MAX_LABEL_TEXT_LENGTH,
  maxLabelCount = DEFAULT_MAX_LABEL_COUNT
}: EditableLabelsProps) {
  const [inputVal, setInputVal] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const classes = colorClassMap[color];
  const {t} = useTranslation();
  const normalizedLabels = labels.slice(0, maxLabelCount);

  const addLabel = useCallback(() => {
    const val = inputVal.trim().slice(0, maxLabelTextLength);
    if (val && !normalizedLabels.includes(val)) {
      onChange([...normalizedLabels, val]);
    }
    setInputVal('');
    setIsEditing(false);
  }, [inputVal, normalizedLabels, onChange, maxLabelTextLength]);

  const removeLabel = useCallback(
    (label: string) => {
      onChange(normalizedLabels.filter((l) => l !== label));
    },
    [normalizedLabels, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addLabel();
      } else if (e.key === 'Escape') {
        setInputVal('');
        setIsEditing(false);
      }
    },
    [addLabel]
  );
  
  const labelPy = size === 'normal' ? 'py-1.5' : 'py-0.5';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${align === 'end' ? 'justify-end' : ''}`}>
      {normalizedLabels.map((label) => (
        <TraitBadge
          key={label}
          text={label}
          color={color}
          py={labelPy}
          onRemove={() => removeLabel(label)}
        />
      ))}

      {isEditing ? (
        <input
          autoFocus
          type="text"
          value={inputVal}
          maxLength={maxLabelTextLength}
          onChange={(e) => setInputVal(e.target.value.slice(0, maxLabelTextLength))}
          onKeyDown={handleKeyDown}
          onBlur={addLabel}
          placeholder={placeholder || t('pages.agents.details.labels.save')}
          className={`px-3 ${labelPy} rounded-full text-sm border border-gray-300 bg-white
                     focus:ring-1 ${classes.ringFocus} ${classes.borderFocus} outline-none
                     min-w-[80px] max-w-[160px]`}
        />
      ) : (
        normalizedLabels.length < maxLabelCount ? <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={`inline-flex items-center gap-1 px-3 ${labelPy} rounded-full text-sm
                     border border-dashed border-gray-300 text-gray-500
                     ${classes.hoverText} ${classes.hoverBg}
                     transition-colors cursor-pointer`}
        >
          <Plus size={14} />
          {t('web.add')}
        </button> : null
      )}
    </div>
  );
}
