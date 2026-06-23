'use client';

import { AgentCard } from './AgentCard';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';

interface AgentListProps {
  onSelect?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AgentList({ onSelect, collapsed = false, onToggleCollapse }: AgentListProps) {
  const {t} = useTranslation();
  const { activeAgents, getOneOngoingProject } = useAppStore();

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center py-3 border-b border-gray-200 shrink-0
        ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}
      >
        {!collapsed && <h2 className="text-lg font-semibold text-gray-900">
          {t('pages.agents.list.title')}
        </h2>}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600
              transition-colors cursor-pointer"
            title={collapsed ? t('common.toggle.expand') : t('common.toggle.collapse')}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto space-y-2 ${collapsed ? 'p-2' : 'p-4'}`}>
        {activeAgents.map((agent) => (
          <AgentCard
            project={getOneOngoingProject(agent.id)}
            key={agent.id}
            agent={agent}
            collapsed={collapsed}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
