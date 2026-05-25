'use client';

import { useAppStore } from '@/lib/store';
import { TaskCard } from './TaskCard';

const columns = [
  { id: 'backlog', title: '📥 待规划', color: 'bg-gray-50' },
  { id: 'todo', title: '📋 待办', color: 'bg-blue-50' },
  { id: 'in_progress', title: '🔄 进行中', color: 'bg-yellow-50' },
  { id: 'review', title: '👀 审核中', color: 'bg-purple-50' },
  { id: 'done', title: '✅ 已完成', color: 'bg-green-50' },
];

export function TaskBoard() {
  const { tasks } = useAppStore();

  return (
    <div className="h-full overflow-x-auto">
      <div className="flex gap-4 min-w-max p-1">
        {columns.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.id);
          
          return (
            <div 
              key={column.id}
              className={`w-72 ${column.color} rounded-xl p-3`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">{column.title}</h3>
                <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded-full">
                  {columnTasks.length}
                </span>
              </div>
              
              <div className="space-y-3">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
              
              {columnTasks.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  暂无任务
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
