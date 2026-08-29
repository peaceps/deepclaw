'use client';

import { useState, useRef, useCallback } from 'react';
import { Ban, CirclePause, ClipboardCheck, Loader2, Pencil } from 'lucide-react';
import  { type Task, type AgentEmployee, getTaskProgress, PROJECT_CONFIG } from '@deepclaw/core';
import { TaskOwnerTooltip } from './TaskOwnerTooltip'
import { AssigneePicker } from './AssigneePicker'
import { useTranslation } from 'react-i18next';
import {avatarBG, priorityStyles} from '../styles-mapping';
import { ProgressBar } from '@/laf/progress-bar';
import { updateProjectTask as updateProjectTaskToServer } from '@/server/data';
import { useAppStore } from '@/lib/store';
import { TaskOutput } from '../../laf/task-output';

type TaskCardProps = {
  task: Task;
  assignee?: AgentEmployee;
  blockedByTitles?: string[];
  projectId: string;
}

/**
 * One of the written fields of the card under a pencil: a draft of its own while the box is open,
 * and a save on the way out. Only words that changed into something are worth a save, so leaving
 * the box as it was found, or emptied, is the same as closing it.
 */
function useEditableField(value: string, save: (next: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const start = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== value) {
      save(next);
    }
    setEditing(false);
  }, [draft, value, save]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }, [commit]);

  return {editing, draft, setDraft, start, commit, onKeyDown};
}

export function TaskCard({ task, assignee, blockedByTitles, projectId }: TaskCardProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [pickingAssignee, setPickingAssignee] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const assigneePencilRef = useRef<HTMLButtonElement>(null);
  const {t} = useTranslation();
  const progress = getTaskProgress(task);
  const updateProjectTask = useAppStore(s => s.updateProjectTask);
  const activeAgents = useAppStore(s => s.activeAgents);
  // An ongoing task only says the work was taken up, this says a subagent is on it right now.
  const running = useAppStore(s => s.runningTasks)
    .some(run => run.projectId === projectId && run.taskId === task.id);
  // The loop already stopped at the gate, so lifting the pause frees nothing, only a verdict does.
  const awaitingVerify = !!task.pause && task.verified === false;

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(true);
  };

  /** The card draws the change straight away and takes it back off if the server refused it. */
  const patchTask = useCallback((patch: Partial<Task>, rollback: Partial<Task>) => {
    updateProjectTask(projectId, { id: task.id, ...patch });
    updateProjectTaskToServer(projectId, { id: task.id, ...patch }).catch(() => {
      updateProjectTask(projectId, { id: task.id, ...rollback });
    });
  }, [projectId, task.id, updateProjectTask]);

  const handlePauseClick = useCallback(() => {
    if (awaitingVerify) return;
    const next = !task.pause;
    patchTask({ pause: next }, { pause: !next });
  }, [task.pause, awaitingVerify, patchTask]);

  // Only a task nobody started yet: work under way belongs to the agent that took it up, and the
  // server says so as well, so the pencil is not there to be refused.
  const canReassign = task.status === 'todo';

  const handleAssigneePick = useCallback((agentId: string) => {
    setPickingAssignee(false);
    if (agentId === task.assignee) return;
    patchTask({ assignee: agentId }, { assignee: task.assignee });
  }, [task.assignee, patchTask]);

  const handleVerifiedClick = useCallback(() => {
    if (!task.pause || task.status !== 'ongoing') return;
    const next = !task.verified;
    patchTask({ verified: next }, { verified: !next });
  }, [task.verified, task.pause, task.status, patchTask]);

  const title = useEditableField(task.title, useCallback(
    next => patchTask({ title: next }, { title: task.title }), [patchTask, task.title]
  ));
  const description = useEditableField(task.description, useCallback(
    next => patchTask({ description: next }, { description: task.description }),
    [patchTask, task.description]
  ));

  if (!assignee) return null;

  return (
    <>
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2">
          {title.editing ? (
            <input
              autoFocus
              type="text"
              value={title.draft}
              maxLength={PROJECT_CONFIG.maxTaskTitleLength}
              onChange={(e) => title.setDraft(e.target.value)}
              onKeyDown={title.onKeyDown}
              onBlur={title.commit}
              className="flex-1 min-w-0 px-2 py-0.5 rounded-md border border-gray-300 bg-white
                font-medium text-gray-900 outline-none focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400"
            />
          ) : (
            <h4 className="flex-1 min-w-0">
              {/* The words themselves open the box, so a narrow screen has a way in without the
                  pencil taking room on a card that is already tight. */}
              <button
                type="button"
                onClick={title.start}
                title={t('web.pages.projects.task.editTitle')}
                className="group flex w-full min-w-0 items-start gap-1.5 text-left"
              >
                <span className="font-medium text-gray-900 line-clamp-2">{task.title}</span>
                <Pencil size={12} className="hidden sm:block flex-shrink-0 mt-1 text-gray-300
                  group-hover:text-gray-600 transition-colors" />
              </button>
            </h4>
          )}
          {running && (
            <span title={t('web.pages.projects.task.running')} className="flex-shrink-0 mt-0.5">
              <Loader2 size={16} className="text-cyan-500 animate-spin" />
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityStyles[task.priority]}`}>
            {t(`web.common.priority.${task.priority}`)}
          </span>
        </div>

        {description.editing ? (
          // Enter saves rather than breaking the line: the box only ever holds the one sentence
          // the card shows, and a card is no place to write a paragraph into.
          <textarea
            autoFocus
            rows={2}
            value={description.draft}
            maxLength={PROJECT_CONFIG.maxTaskDescriptionLength}
            onChange={(e) => description.setDraft(e.target.value)}
            onKeyDown={description.onKeyDown}
            onBlur={description.commit}
            className="w-full mt-2 px-2 py-1 rounded-md border border-gray-300 bg-white resize-none
              text-sm text-gray-600 outline-none focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400"
          />
        ) : (
          <p className="text-sm text-gray-500 mt-2">
            <button
              type="button"
              onClick={description.start}
              title={t('web.pages.projects.task.editDescription')}
              className="group flex w-full min-w-0 items-start gap-1.5 text-left"
            >
              <span className="line-clamp-2">{task.description}</span>
              <Pencil size={12} className="hidden sm:block flex-shrink-0 mt-0.5 text-gray-300
                group-hover:text-gray-600 transition-colors" />
            </button>
          </p>
        )}

        {/* Assignee - 可点击 */}
        <div className="mt-1 flex items-center justify-between gap-2">
          <div
            ref={assigneeRef}
            onClick={handleAssigneeClick}
            className="inline-flex items-center gap-2 cursor-pointer hover:bg-gray-100
              max-sm:pointer-events-none rounded-lg p-1 -ml-1 transition-colors"
          >
            <div className={`w-6 h-6 rounded-full ${avatarBG} flex items-center justify-center text-xs`}>
              {assignee.avatar}
            </div>
            <span className="text-xs text-gray-600">{assignee.name}</span>
          </div>
          {canReassign && (
            <button
              ref={assigneePencilRef}
              type="button"
              onClick={(e) => { e.stopPropagation(); setPickingAssignee(v => !v); }}
              title={t('web.pages.projects.task.editAssignee')}
              aria-label={t('web.pages.projects.task.editAssignee')}
              className="flex-shrink-0 p-1 -ml-1 rounded text-gray-300 hover:text-gray-600
                hover:bg-gray-100 transition-colors"
            >
              <Pencil size={12} />
            </button>
          )}
          <div className='flex-1'></div>
          {task.status !== 'done' && <button
              onClick={handlePauseClick}
              disabled={awaitingVerify}
              className='mr-1 flex-shrink-0 disabled:cursor-not-allowed'
              title={t(`web.pages.projects.task.pause.title.${
                awaitingVerify ? 'locked' : task.pause ? 'on' : 'off'}`)}>
            <CirclePause size={18} className={`${task.pause ? 'text-yellow-500' : 'text-gray-200'}`} />
          </button>}
          {task.status === 'ongoing' && task.pause && typeof task.verified === 'boolean' && <button
              onClick={handleVerifiedClick}
              className='mr-1 flex-shrink-0'
              title={t(`web.pages.projects.task.verified.title.${task.verified ? 'on' : 'off'}`)}>
            <ClipboardCheck size={18} className={`${task.verified ? 'text-green-500' : 'text-gray-200'}`} />
          </button>}
          {blockedByTitles && blockedByTitles.length > 0 && (
            <span title={t('web.pages.projects.project.blockedBy', { titles: blockedByTitles.join('/') })} className="flex-shrink-0">
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

        {task.output && <TaskOutput output={task.output} title={task.title}/>}
      </div>

      <TaskOwnerTooltip
        agent={assignee}
        visible={tooltipVisible}
        anchorRef={assigneeRef}
        onClose={() => setTooltipVisible(false)}
      />

      {pickingAssignee && (
        <AssigneePicker
          agents={activeAgents}
          selectedId={task.assignee}
          anchorRef={assigneePencilRef}
          onPick={handleAssigneePick}
          onClose={() => setPickingAssignee(false)}
        />
      )}
    </>
  );
}
