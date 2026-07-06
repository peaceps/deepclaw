'use client';

import { InfoCard } from '@/laf/info-card';
import { Pencil, User } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentEmployee } from '@deepclaw/core';

interface AgentDetailDescriptionProps {
  agent: AgentEmployee;
  onUpdate: (id: string, description: string) => void;
}

export function AgentDetailDescription({ agent, onUpdate }: AgentDetailDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(agent.description);
  const {t} = useTranslation();

  const startEditing = useCallback(() => {
    setValue(agent.description);
    setEditing(true);
  }, [agent.description]);

  const commit = useCallback(() => {
    if (!editing) return;
    const trimmed = value.trim();
    setValue(trimmed);
    setEditing(false);
    if (trimmed !== agent.description) {
      onUpdate(agent.id, trimmed);
    }
  }, [editing, value, onUpdate, agent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setValue(agent.description);
        setEditing(false);
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
    [agent.description, commit]
  );

  return (
    <InfoCard title="pages.agents.details.description.title" icon={<User size={20}/>} color='orange'>
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          rows={4}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50/50 text-sm text-gray-700
                     focus:ring-1 focus:ring-orange-300 focus:border-orange-300 focus:bg-white outline-none
                     resize-y min-h-[80px] transition-colors"
        />
      ) : (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-gray-700 min-h-[20px]">
            {agent.description || <span className="text-gray-400">{t('pages.agents.details.description.noContent')}</span>}
          </p>
          <button
            type="button"
            onClick={startEditing}
            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition-colors cursor-pointer"
            aria-label={t('web.edit')}
          >
            <Pencil size={14} />
          </button>
        </div>
      )}
    </InfoCard>
  );
}
