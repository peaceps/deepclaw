'use client';

import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type AgentActionMenuItem = {
  label: string;
  onClick: () => void;
};

type AgentActionMenuProps = {
  className?: string;
  actions?: AgentActionMenuItem[];
};

const noop = () => {};

export function AgentActionMenu({
  className = '',
  actions,
}: AgentActionMenuProps) {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuActions = actions ?? [
    { label: t('web.pages.agents.actions.praise'), onClick: noop },
    { label: t('web.pages.agents.actions.criticize'), onClick: noop },
  ];

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleButtonClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setOpen(value => !value);
  };

  const handleActionClick = (action: AgentActionMenuItem) => (event: React.MouseEvent) => {
    event.stopPropagation();
    action.onClick();
    setOpen(false);
  };

  return (
    <div ref={menuRef} className={`inline-flex absolute ${className}`} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title={t('web.pages.agents.actions.more')}
        aria-haspopup="menu"
        aria-label={t('web.pages.agents.actions.more')}
        aria-expanded={open}
        onClick={handleButtonClick}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 min-w-24 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {menuActions.map(action => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={handleActionClick(action)}
              className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
