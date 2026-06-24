'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

interface EmojiPickerProps {
  value: string;
  onSelect: (emoji: string) => void;
  title?: string;
  className?: string;
  placement?: 'top' | 'bottom';
}

export function EmojiPicker({ value, onSelect, title, className, placement = 'bottom' }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onEmojiSelect = useCallback((emoji: { native: string }) => {
    if (!emoji.native) {
      return;
    }
    onSelect(emoji.native);
    setOpen(false);
  }, [onSelect]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`cursor-pointer transition-transform hover:scale-105 ${className ?? ''}`}
      >
        {value}
      </button>

      {open && (
        <div className={`absolute z-20 left-0 ${placement === 'top' ? 'bottom-full mb-2' : 'mt-2'}`}>
          <Picker
            data={data}
            onEmojiSelect={onEmojiSelect}
            previewPosition="none"
            skinTonePosition="none"
          />
        </div>
      )}
    </div>
  );
}
