'use client';

import type { AgentEmployee } from '@deepclaw/core';
import { AgentExpandedCard } from './AgentExpandedCard';
import { AgentCollapsedCard } from './AgentCollapsedCard';

type AgentCardProps = {
  agent: AgentEmployee;
  collapsed?: boolean;
  onSelect?: () => void;
}

export function AgentCard({ agent, collapsed = false, onSelect }: AgentCardProps) {

  if (collapsed) {
    return <AgentCollapsedCard
        agent={agent}
        onSelect={onSelect}
    />;
  }

  return (
    <AgentExpandedCard
      agent={agent}
      onSelect={onSelect}
    />
  );
}
