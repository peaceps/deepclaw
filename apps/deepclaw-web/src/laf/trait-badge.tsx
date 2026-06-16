'use client';

import { X } from 'lucide-react';
import { colorClassMap, DeepColors } from './laf-types';

interface TraitBadgeProps {
    text: string;
    color: DeepColors;
    onRemove?: () => void;
}

export function TraitBadge({ text, color, onRemove }: TraitBadgeProps) {
    const classes = colorClassMap[color];
    return (
      <span
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm
            font-medium border transition-colors
            ${classes.bg} ${classes.textMuted} ${classes.border} ${classes.bgHover}
            ${onRemove ? 'pr-2' : ''}`
        }
      >
        {text}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors cursor-pointer"
            aria-label={`Remove ${text}`}
          >
            <X size={14} />
          </button>
        )}
      </span>
    );
}
