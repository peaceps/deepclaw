'use client';

import { AgentCard } from './AgentCard';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';

interface AgentListProps {
  onSelect?: () => void;
}

export function AgentList({ onSelect }: AgentListProps) {
  const {t} = useTranslation();
  const { activeAgents, getOneOngoingProject } = useAppStore();

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 px-1">{t('pages.agents.list.title')}</h2>
      <div className="space-y-2">
        {activeAgents.map((agent) => (
          <AgentCard
            project={getOneOngoingProject(agent.id)}
            key={agent.id}
            agent={agent}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
