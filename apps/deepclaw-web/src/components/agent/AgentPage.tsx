'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import { MobileAgentPage } from './mobile/MobileAgentPage';
import { DesktopAgentPage } from './DesktopAgentPage';

export function AgentPage({agents, projects}: {agents: AgentEmployee[], projects: Project<Task>[]}) {
  const { selectedAgentId, setSelectedAgent } = useAppStore();

  useEffect(() => {
    if (!agents.some(agent => agent.id === selectedAgentId)) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgentId, setSelectedAgent]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-full flex">
      {/* Desktop Layout */}
      <div className="hidden lg:flex h-full w-full">
        <DesktopAgentPage agents={agents} projects={projects} selectedAgent={selectedAgent}/>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex-1 flex flex-col h-full overflow-hidden">
        <MobileAgentPage agents={agents} projects={projects} selectedAgent={selectedAgent}/>
      </div>
    </div>
  );
}
