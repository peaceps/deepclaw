'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Notebook } from 'lucide-react';
import type { SlimProject } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { TaskCard } from './TaskCard';
import { ProjectActions } from './ProjectActions';
import { useProjectTasks } from '@/lib/use-project-tasks';
import { useAppStore } from '@/lib/store';

const columns = [
  { id: 'todo', icon: '📋', title: 'web.pages.projects.status.todo', color: 'bg-blue-50' },
  { id: 'ongoing', icon: '🔄', title: 'web.pages.projects.status.ongoing', color: 'bg-yellow-50' },
  { id: 'done', icon: '✅', title: 'web.pages.projects.status.done', color: 'bg-green-50' },
];

type ProjectTasksProps = {
    project: SlimProject;
}

export function ProjectTasks({project}: ProjectTasksProps) {
  const [collapsed, setCollapsed] = useState(false);
  const {t} = useTranslation();
  const agents = useAppStore(s => s.agents);
  // This panel is mounted by the row being opened, so this is the opening asking for the tasks --
  // where they are not in hand already from an earlier opening, which asks for nothing and draws
  // the board at once.
  const {unread} = useProjectTasks([project.id]);
  const tasks = project.tasks;

    // The tasks scroll, the bar under them does not: what can be done with the project as a whole
    // stays where it was put, rather than being something to scroll a long board to reach.
    return (
        <div className={`flex flex-col items-center border-r border-gray-200 bg-gray-50 transition-all duration-300
          lg:max-h-[600px] ${collapsed ? 'w-12' : 'lg:w-[60%]'}`}>
            
          <div className={`hidden lg:flex items-center border-b border-gray-200
              bg-gray-50 w-full ${collapsed ? 'flex-col' : 'pl-6 justify-end'} py-3`}>
            {!collapsed && <p className="flex-1 text-sm text-gray-500 truncate hidden sm:block" title={project.description}>
                {project.description}
            </p>}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={`p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors ${collapsed ? '' : 'mr-2'}`}
              title={collapsed ? t('web.common.toggle.expand') : t('web.common.toggle.collapse')}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {collapsed ? (
                <div className="flex-1 bg-gray-50 text-gray-400 py-3">
                    <Notebook size={20} />
                </div>
            ) : (
                <div className="flex-1 min-h-0 lg:overflow-y-auto p-4 bg-gray-50/50 w-full">
                    {/* No tasks held is a project not read yet rather than a project with none:
                        which of the two it is, only the answer coming back can say. */}
                    {!tasks ? (
                    <div className="py-8 text-center text-gray-400">
                        {unread
                          ? <p>{t('web.pages.projects.project.tasksUnread')}</p>
                          : <Loader2 size={20} className="mx-auto animate-spin" />}
                    </div>
                    ) : Object.keys(tasks).length === 0 ? (
                    <div className="py-8 text-center text-gray-400"><p>{t('web.pages.projects.project.noTasks')}</p></div>
                    ) : (
                    <div className="flex flex-col lg:flex-row gap-4 max-sm:max-h-[600px] max-sm:overflow-y-auto">
                        {columns.map(column => {
                        const columnTasks = Object.values(tasks).filter(task => task.status === column.id);
                        return (
                            <div key={column.id} className={`w-full lg:w-64 ${column.color} rounded-lg p-3 flex-shrink-0 flex-1`}>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-gray-800 text-sm">{column.icon} {t(column.title)}</h4>
                                <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">{columnTasks.length}</span>
                            </div>
                            <div className="space-y-2">
                                {columnTasks.map(task => <TaskCard 
                                    key={task.id} task={task} projectId={project.id}
                                    assignee={task.assignee ? agents.find(a => a.id === task.assignee) : undefined}
                                    blockedByTitles={task.blockedBy.flatMap(id => {
                                      const blocker = tasks[id];
                                      return blocker && blocker.status !== 'done' ? [blocker.title] : [];
                                    })}
                                />)}
                            </div>
                            {columnTasks.length === 0 && <div className="text-center py-6 text-gray-400 text-xs">{t('web.pages.projects.project.noTasksAtStatus')}</div>}
                            </div>
                        );
                        })}
                    </div>
                    )}
                </div>
            )}
            {/* Nothing of the project fits in a rail twelve wide, so a folded panel shows none of
                it: the panel opens by the chevron above, which is there either way. */}
            {!collapsed && <ProjectActions project={project} />}
        </div>
    );
}
