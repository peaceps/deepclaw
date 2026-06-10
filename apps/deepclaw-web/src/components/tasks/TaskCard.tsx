'use client';

import { useState, useRef } from 'react';
import { Task, AgentEmployee } from '@/types';
import { TaskOwnerTooltip } from './TaskOwnerTooltip'
import { useTranslation } from 'react-i18next';
import {priorityTexts, priorityStyles} from '../styles-mapping';

type TaskCardProps = {
  task: Task;
  assignee?: AgentEmployee
}

export function TaskCard({ task, assignee }: TaskCardProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const {t} = useTranslation();

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (assignee) {
      setTooltipVisible(true);
    }
  };

  if (!assignee) return null;

  return (
    <>
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-gray-900 line-clamp-2 flex-1">{task.title}</h4>
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityStyles[task.priority]}`}>
            {t(priorityTexts[task.priority])}
          </span>
        </div>

        <p className="text-sm text-gray-500 mt-2 line-clamp-2">{task.description}</p>

        {/* Assignee - 可点击 */}
        <div
          ref={assigneeRef}
          onClick={handleAssigneeClick}
          className="mt-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded-lg p-1 -ml-1 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xs">
            {assignee.avatar}
          </div>
          <span className="text-xs text-gray-600">{assignee.name}</span>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div className="flex gap-1">
            {task.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {task.status === 'ongoing' && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-500">{t('pages.projects.project.progress')}</span>
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

      <TaskOwnerTooltip
        agent={assignee}
        visible={tooltipVisible}
        anchorRef={assigneeRef}
        onClose={() => setTooltipVisible(false)}
      />
    </>
  );
}
