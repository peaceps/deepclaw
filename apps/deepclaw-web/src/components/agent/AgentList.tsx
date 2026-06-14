'use client';

import { AgentCard } from './AgentCard';
import type { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { getProjectStatus } from '../component-utils';

interface AgentListProps {
  agents: AgentEmployee[];
  projects: Project<Task>[];
  onSelect?: () => void;
}

export function AgentList({ projects, agents, onSelect }: AgentListProps) {
  const {t} = useTranslation();

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 px-1">{t('pages.agents.list.title')}</h2>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
            project={projects.find(p => p.creator === agent.id && getProjectStatus(p) !== 'done')}
            key={agent.id}
            agent={agent}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
