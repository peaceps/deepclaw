'use client';

import { useAppStore } from '@/lib/store';
import { AgentCard } from './AgentCard';
import { AgentEmployee } from '@deepclaw/gateway';

interface AgentListProps {
  agents: AgentEmployee[];
  onSelect?: () => void;
}

export function AgentList({ agents, onSelect }: AgentListProps) {
  const { selectedAgentId, setSelectedAgent } = useAppStore();

  const handleSelect = (agentId: string) => {
    setSelectedAgent(agentId);
    onSelect?.();
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 px-1">Agent 员工</h2>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
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
