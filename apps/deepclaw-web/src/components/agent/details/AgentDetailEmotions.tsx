'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The thought bubble next to the mood opens everything the agent has felt this session. The emotions are
 * only kept in the browser store, so the list starts over whenever the page is loaded again.
 * Desktop only, like the other affordances of this header: the name row of a narrow screen has no
 * width to spare, and a panel anchored that far right would hang out of the viewport.
 */
export function AgentDetailEmotions({ emotions = [] }: { emotions?: string[] }) {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    return () => document.removeEventListener('mousedown', closeOnOutside);
  }, [open]);

  return (
    <div ref={panelRef} className="relative hidden sm:inline-flex">
      <button
        type="button"
        title={t('web.pages.agents.details.header.emotions')}
        aria-label={t('web.pages.agents.details.header.emotions')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full
          transition-colors hover:bg-gray-100"
      >
        {/* Faded while there is nothing to read, so the card says as much without being opened. */}
        <span className={`text-2xl leading-none ${emotions.length ? '' : 'opacity-30 grayscale'}`}>
          💭
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('web.pages.agents.details.header.emotions')}
          className="absolute left-0 top-full z-20 mt-1 w-64 sm:w-80 max-h-[320px] overflow-y-auto
            rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {emotions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-400">
              {t('web.pages.agents.details.header.noEmotions')}
            </p>
          ) : (
            // The newest feeling is the one worth reading first.
            [...emotions].reverse().map((emotion, index) => (
              <p
                key={`${emotions.length - index}-${emotion}`}
                className="px-3 py-2 text-sm text-gray-700 break-words border-b border-gray-100
                  last:border-b-0"
              >
                {emotion}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}
