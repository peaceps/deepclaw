'use client';

import { AgentEmployee } from '@/types';
import { statusColors, statusLabels, moodEmojis } from '@/lib/utils';

interface AgentCardProps {
  agent: AgentEmployee;
  isSelected?: boolean;
  onClick?: () => void;
}

export function AgentCard({ agent, isSelected, onClick }: AgentCardProps) {
  return (
    <div
      onClick={onClick}
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
          <p className="text-xs text-gray-400 mt-1">{agent.department}</p>
        </div>
      </div>
      
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className={`px-2 py-1 rounded-full ${statusColors[agent.status].replace('bg-', 'bg-opacity-20 bg-')} text-gray-600`}>
          {statusLabels[agent.status]}
        </span>
        <span className="text-gray-400">
          已完成 {agent.stats.tasksCompleted} 个任务
        </span>
      </div>
      
      {agent.currentTask && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">当前任务</p>
          <p className="text-sm font-medium text-gray-700 truncate">{agent.currentTask.title}</p>
          <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${agent.currentTask.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
