'use client';

import { useAppStore } from '@/lib/store';
import { AgentCard } from './AgentCard';

export function AgentList() {
  const { agents, selectedAgentId, setSelectedAgent } = useAppStore();

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 px-1">Agent 员工</h2>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => setSelectedAgent(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
