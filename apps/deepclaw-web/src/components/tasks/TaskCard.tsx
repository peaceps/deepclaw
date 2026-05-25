'use client';

import { Task } from '@/types';
import { priorityColors, priorityLabels, formatDuration } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium text-gray-900 line-clamp-2 flex-1">{task.title}</h4>
        <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityColors[task.priority]}`}>
          {priorityLabels[task.priority]}
        </span>
      </div>
      
      <p className="text-sm text-gray-500 mt-2 line-clamp-2">{task.description}</p>
      
      <div className="mt-3 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xs">
          {task.assignee.avatar}
        </div>
        <span className="text-xs text-gray-600">{task.assignee.name}</span>
      </div>
      
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-3">
          <span>⏱️ {formatDuration(task.estimatedHours)}</span>
          {task.dueDate && (
            <span>📅 {new Date(task.dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
          )}
        </div>
        <div className="flex gap-1">
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
              {tag}
            </span>
          ))}
        </div>
      </div>
      
      {task.status === 'in_progress' && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">进度</span>
            <span className="font-medium text-gray-700">{task.progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
