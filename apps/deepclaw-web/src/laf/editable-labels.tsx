'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { TraitBadge } from './trait-badge';
import { colorClassMap, DeepColors } from './laf-types';
import { useTranslation } from 'react-i18next';

interface EditableLabelsProps {
  labels: string[];
  onChange: (labels: string[]) => void;
  color: DeepColors;
  placeholder?: string;
}

export function EditableLabels({
  labels,
  onChange,
  color,
  placeholder,
}: EditableLabelsProps) {
  const [inputVal, setInputVal] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const classes = colorClassMap[color];
  const {t} = useTranslation();

  const addLabel = useCallback(() => {
    const val = inputVal.trim();
    if (val && !labels.includes(val)) {
      onChange([...labels, val]);
    }
    setInputVal('');
    setIsEditing(false);
  }, [inputVal, labels, onChange]);

  const removeLabel = useCallback(
    (label: string) => {
      onChange(labels.filter((l) => l !== label));
    },
    [labels, onChange]
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label) => (
        <TraitBadge
          key={label}
          text={label}
          color={color}
          onRemove={() => removeLabel(label)}
        />
      ))}

      {isEditing ? (
        <input
          autoFocus
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addLabel}
          placeholder={placeholder || t('pages.agents.details.labels.save')}
          className={`px-3 py-1.5 rounded-full text-sm border border-gray-300 bg-white
                     focus:ring-1 ${classes.ringFocus} ${classes.borderFocus} outline-none
                     min-w-[80px] max-w-[160px]`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm
                     border border-dashed border-gray-300 text-gray-500
                     ${classes.hoverText} ${classes.hoverBg}
                     transition-colors cursor-pointer`}
        >
          <Plus size={14} />
          {t('common.add')}
        </button>
      )}
    </div>
  );
}
