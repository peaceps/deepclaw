'use client';

import { useState, useRef } from 'react';
import { Ban } from 'lucide-react';
import  { type Task, type AgentEmployee, getTaskProgress } from '@deepclaw/core';
import { TaskOwnerTooltip } from './TaskOwnerTooltip'
import { useTranslation } from 'react-i18next';
import {avatarBG, priorityStyles} from '../styles-mapping';
import { ProgressBar } from '@/laf/progress-bar';

type TaskCardProps = {
  task: Task;
  assignee?: AgentEmployee;
  blockedByTitles?: string[];
}

export function TaskCard({ task, assignee, blockedByTitles }: TaskCardProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const {t} = useTranslation();
  const progress = getTaskProgress(task);

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(true);
  };

  if (!assignee) return null;

  return (
    <>
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-gray-900 line-clamp-2 flex-1">{task.title}</h4>
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityStyles[task.priority]}`}>
            {t(`common.priority.${task.priority}`)}
          </span>
        </div>

        <p className="text-sm text-gray-500 mt-2 line-clamp-2">{task.description}</p>

        {/* Assignee - 可点击 */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <div
            ref={assigneeRef}
            onClick={handleAssigneeClick}
            className="inline-flex items-center gap-2 cursor-pointer hover:bg-gray-50
              max-sm:pointer-events-none rounded-lg p-1 -ml-1 transition-colors"
          >
            <div className={`w-6 h-6 rounded-full ${avatarBG} flex items-center justify-center text-xs`}>
              {assignee.avatar}
            </div>
            <span className="text-xs text-gray-600">{assignee.name}</span>
          </div>
          {blockedByTitles && blockedByTitles.length > 0 && (
            <span title={t('pages.projects.project.blockedBy', { titles: blockedByTitles.join('、') })} className="flex-shrink-0">
              <Ban size={16} className="mr-1 text-gray-500" />
            </span>
          )}
        </div>

        {task.stepsStatus?.steps.length && <div className='mt-1'>
           {task.stepsStatus.steps.map((step, i) => {
             const index = task.stepsStatus!.currentStepIndex;
             return (
              <div key={`${i}-${step}`}
                   className={`text-[10px]/[14px] ${i < index ? "text-lime-600" : i === index ? "text-cyan-600" : "text-gray-500"}`}>
                {step}
              </div>
             )
           })}
        </div>}

        {progress !== null && (
          <ProgressBar value={progress} size="sm" className="mt-2" />
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
