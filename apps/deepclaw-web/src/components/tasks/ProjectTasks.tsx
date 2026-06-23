'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Notebook } from 'lucide-react';
import type { Project } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { TaskCard } from './TaskCard';
import { useAppStore } from '@/lib/store';

const columns = [
  { id: 'todo', icon: '📋', title: 'pages.projects.status.todo', color: 'bg-blue-50' },
  { id: 'ongoing', icon: '🔄', title: 'pages.projects.status.ongoing', color: 'bg-yellow-50' },
  { id: 'done', icon: '✅', title: 'pages.projects.status.done', color: 'bg-green-50' },
];

type ProjectTasksProps = {
    project: Project;
}

export function ProjectTasks({project}: ProjectTasksProps) {
  const [collapsed, setCollapsed] = useState(false);
  const {t} = useTranslation();
  const { getTaskAssignee } = useAppStore();

    return (
        <div className={`flex flex-col items-center border-r border-gray-200 bg-gray-50 transition-all duration-300
          lg:max-h-[600px] lg:overflow-y-auto ${collapsed ? 'w-12' : 'lg:w-[60%]'}`}>
          <div className={`hidden lg:flex items-center border-b border-gray-200 bg-gray-50 w-full ${collapsed ? 'flex-col' : 'justify-end'} py-3`}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors ${collapsed ? '' : 'mr-2'}`}
              title={collapsed ? t('common.toggle.expand') : t('common.toggle.collapse')}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {collapsed ? (
                <div className="flex-1 bg-gray-50 text-gray-400 py-3">
                    <Notebook size={20} />
                </div>
            ) : (
                <div className="flex-1 p-4 bg-gray-50/50 w-full">
                    {Object.keys(project.tasks).length === 0 ? (
                    <div className="py-8 text-center text-gray-400"><p>{t('pages.projects.project.noTasks')}</p></div>
                    ) : (
                    <div className="flex flex-col lg:flex-row gap-4 max-sm:max-h-[600px] max-sm:overflow-y-auto">
                        {columns.map(column => {
                        const columnTasks = Object.values(project.tasks).filter(task => task.status === column.id);
                        return (
                            <div key={column.id} className={`w-full lg:w-64 ${column.color} rounded-lg p-3 flex-shrink-0 flex-1`}>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-800 text-sm">{column.icon} {t(column.title)}</h4>
                                <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">{columnTasks.length}</span>
                            </div>
                            <div className="space-y-2">
                                {columnTasks.map(task => <TaskCard 
                                    key={task.title} task={task} 
                                    assignee={getTaskAssignee(task)}
                                />)}
                            </div>
                            {columnTasks.length === 0 && <div className="text-center py-6 text-gray-400 text-xs">{t('pages.projects.project.noTasksAtStatus')}</div>}
                            </div>
                        );
                        })}
                    </div>
                    )}
                </div>
            )}
        </div>
    );
}
