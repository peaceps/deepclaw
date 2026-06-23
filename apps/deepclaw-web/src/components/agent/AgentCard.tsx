'use client';

import type { Project } from '@deepclaw/core';
import type { AgentEmployee } from '@deepclaw/core';

import { AgentExpandedCard } from './AgentExpandedCard';
import { AgentCollapsedCard } from './AgentCollapsedCard';

type AgentCardProps = {
  project?: Project;
  agent: AgentEmployee;
  collapsed?: boolean;
  onSelect?: () => void;
}

export function AgentCard({ project, agent, collapsed = false, onSelect }: AgentCardProps) {

  if (collapsed) {
    return <AgentCollapsedCard
        agent={agent}
        onSelect={onSelect}
    />;
  }

  return (
    <AgentExpandedCard
      agent={agent}
      project={project}
      onSelect={onSelect}
    />
  );
}
