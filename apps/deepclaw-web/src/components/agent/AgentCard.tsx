'use client';

import { useState, useRef } from 'react';
import type { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import { useAppStore } from '@/lib/store';

import { statusColors, moodEmojis } from '../styles-mapping';
import { useTranslation } from 'react-i18next';
import { AgentTooltip } from './AgentTooltip';
import { AgentCurrentProject } from './AgentCurrentTask';

type AgentCardProps = {
  project?: Project<Task>;
  agent: AgentEmployee;
  onSelect?: () => void;
}

export function AgentCard({ project, agent, onSelect }: AgentCardProps) {
  const { selectedAgentId, setSelectedAgent } = useAppStore();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const {t} = useTranslation();
  const isSelected = selectedAgentId === agent.id
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(true);
    setSelectedAgent(agent.id);
    onSelect?.();
  };

  return (
    <>
      <div
        ref={cardRef}
        onClick={handleClick}
        className={`
          p-4 rounded-xl border-2 cursor-pointer transition-all
          ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
        `}
      >
        <div className="flex items-start gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
              {agent.avatar}
            </div>
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${statusColors[agent.status]}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
              <span className="text-sm">{moodEmojis[agent.mood]}</span>
            </div>
            <p className="text-sm text-gray-500">{agent.role}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={`px-2 py-1 rounded-full ${statusColors[agent.status].replace('bg-', 'bg-opacity-20 bg-')} text-gray-600`}>
            {t(`pages.agents.status.${agent.status}`)}
          </span>
          <span className="text-gray-400">
            {t('pages.agents.card.finishedTasks', {count: agent.stats.tasksCompleted})}
          </span>
        </div>

        {
          project && (
            <AgentCurrentProject project={project} />
          )
        }
      </div>

      <AgentTooltip
        agent={agent}
        visible={tooltipVisible}
        anchorRef={cardRef}
        onClose={() => setTooltipVisible(false)}
      />
    </>
  );
}
