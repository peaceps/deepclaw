'use client';

import { useAppStore } from '@/lib/store';
import { AgentCard } from './AgentCard';
import { AgentEmployee, Project, Task } from '@deepclaw/loop-gateway';
import { useTranslation } from 'react-i18next';

interface AgentListProps {
  agents: AgentEmployee[];
  projects: Project<Task>[];
  onSelect?: () => void;
}

export function AgentList({ projects, agents, onSelect }: AgentListProps) {
  const { selectedAgentId, setSelectedAgent } = useAppStore();
  const {t} = useTranslation();

  const handleSelect = (agentId: string) => {
    setSelectedAgent(agentId);
    onSelect?.();
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 px-1">{t('pages.agents.list.title')}</h2>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
            project={projects.find(p => p.creator === agent.id)}
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => handleSelect(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
