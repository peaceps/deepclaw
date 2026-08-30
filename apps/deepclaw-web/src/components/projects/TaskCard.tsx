'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Ban, CirclePause, ClipboardCheck, FileText, Loader2, MoreHorizontal, Pencil
} from 'lucide-react';
import  {
  type Task, type AgentEmployee, getTaskProgress, type MissionPriority, type MissionStatus,
  PROJECT_CONFIG
} from '@deepclaw/core';
import { TaskOwnerTooltip } from './TaskOwnerTooltip'
import { AssigneePicker } from './AssigneePicker'
import { PriorityPicker } from './PriorityPicker'
import { TaskStatusMenu } from './TaskStatusMenu'
import { useTranslation } from 'react-i18next';
import {avatarBG, priorityStyles} from '../styles-mapping';
import { ProgressBar } from '@/laf/progress-bar';
import {
  finishProjectTask as finishProjectTaskOnServer,
  takeUpProjectTask as takeUpProjectTaskOnServer,
  updateProjectTask as updateProjectTaskToServer,
  type TaskEdit,
} from '@/server/data';
import { useAppStore } from '@/lib/store';
import { useEditableField } from '@/lib/use-editable-field';
import { TaskOutput } from '../../laf/task-output';

/** What a card may ask the server to write, the id of the task being the card's own to fill in. */
type TaskPatch = Omit<TaskEdit, 'id'>;

type TaskCardProps = {
  task: Task;
  assignee?: AgentEmployee;
  /** Whoever reads the task over, and nobody on nearly every task: no reviewer, no row. */
  reviewer?: AgentEmployee;
  blockedByTitles?: string[];
  projectId: string;
  /** Taking a task up sets an unstarted project going, which the menu says while that is so. */
  projectStarted: boolean;
}

export function TaskCard(
  { task, assignee, reviewer, blockedByTitles, projectId, projectStarted }: TaskCardProps
) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [pickingAssignee, setPickingAssignee] = useState(false);
  const [pickingReviewer, setPickingReviewer] = useState(false);
  const [pickingPriority, setPickingPriority] = useState(false);
  const [movingStatus, setMovingStatus] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const assigneePencilRef = useRef<HTMLButtonElement>(null);
  const reviewerPencilRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const {t} = useTranslation();
  const progress = getTaskProgress(task);
  const updateProjectTask = useAppStore(s => s.updateProjectTask);
  const activeAgents = useAppStore(s => s.activeAgents);
  // An ongoing task only says the work was taken up, these say what is happening on it right now:
  // the work, by a subagent it was handed to or by the agent working it in this very turn of its
  // own, and the reading of that work. The two are apart because they mean different things to a
  // card: work being on is what takes the status out of the user's hands, a reading takes nothing
  // away from anybody.
  const runs = useAppStore(s => s.runningTasks);
  const onTask = (kind: 'work' | 'review') => runs.some(
    run => run.projectId === projectId && run.taskId === task.id && run.kind === kind
  );
  const running = onTask('work');
  const reviewing = onTask('review');
  // The loop already stopped at the gate, so lifting the pause frees nothing, only a verdict does.
  const awaitingVerify = !!task.pause && task.verified === false;

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(true);
  };

  /** The card draws the change straight away and takes it back off if the server refused it. */
  const draw = useCallback((
    patch: Partial<Task>, rollback: Partial<Task>, save: () => Promise<void>
  ) => {
    updateProjectTask(projectId, { id: task.id, ...patch });
    save().catch(() => {
      updateProjectTask(projectId, { id: task.id, ...rollback });
    });
  }, [projectId, task.id, updateProjectTask]);

  // The patch is what the server is asked for and is held to what a card may write; the rollback is
  // only ever drawn, and puts back whatever the task had.
  const patchTask = useCallback((patch: TaskPatch, rollback: Partial<Task>) => {
    draw(patch, rollback, () => updateProjectTaskToServer(projectId, { id: task.id, ...patch }));
  }, [draw, projectId, task.id]);

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

  // The empty word is a pick like any other here: it is how the row is taken off the card again.
  const handleReviewerPick = useCallback((agentId: string) => {
    setPickingReviewer(false);
    if (agentId === (task.reviewer ?? '')) return;
    patchTask({ reviewer: agentId }, { reviewer: task.reviewer });
  }, [task.reviewer, patchTask]);

  // Work still to be done can be reordered; work that is done cannot, and the server says the same.
  const canReprioritize = task.status !== 'done';
  const pill = `text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityStyles[task.priority]}`;

  const handlePriorityPick = useCallback((priority: MissionPriority) => {
    setPickingPriority(false);
    if (priority === task.priority) return;
    patchTask({ priority }, { priority: task.priority });
  }, [task.priority, patchTask]);

  // A task that is done is where the board stops: nothing here moves it back, and the service
  // refuses it from either direction. While a subagent is on the task its status is the run's.
  const canMoveStatus = task.status !== 'done';

  // The menu goes wherever the button under it went. A subagent taking the task over disables the
  // button, and the task reaching done takes it off the card altogether -- and the menu is drawn
  // apart from the card, so it would be left floating there offering a step that is no longer
  // anybody's to take. Put right while rendering rather than after it: this follows what the card
  // is drawn from, and a second render to catch up would draw the menu once more on the way.
  const canOpenStatusMenu = canMoveStatus && !running;
  const [couldOpenStatusMenu, setCouldOpenStatusMenu] = useState(canOpenStatusMenu);
  if (couldOpenStatusMenu !== canOpenStatusMenu) {
    setCouldOpenStatusMenu(canOpenStatusMenu);
    if (!canOpenStatusMenu) setMovingStatus(false);
  }

  /**
   * Each of these is asked for as the one thing it is, the server writing more than the word for
   * either. The steps of the task are drawn behind it here along with the word: a card left saying
   * step three of eight under a task that is done would be put right by the announcement a moment
   * later, and read wrong until it came.
   */
  const handleStatusPick = useCallback((next: MissionStatus) => {
    setMovingStatus(false);
    if (next === 'ongoing') {
      draw(
        { status: 'ongoing' },
        { status: task.status },
        () => takeUpProjectTaskOnServer(projectId, task.id),
      );
      return;
    }
    const steps = task.stepsStatus?.steps;
    draw(
      {
        status: 'done',
        ...(steps?.length ? {stepsStatus: {steps, currentStepIndex: steps.length}} : {}),
        // Their word closes the task, which is the verdict a paused one was waiting for.
        ...(task.pause ? {verified: true} : {}),
      },
      { status: task.status, stepsStatus: task.stepsStatus, verified: task.verified },
      () => finishProjectTaskOnServer(projectId, task.id),
    );
  }, [draw, projectId, task.id, task.pause, task.status, task.stepsStatus, task.verified]);

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
                  pencil taking room on a card that is already tight.

                  The word for it hangs on the pencil rather than on the button, though the button
                  is the whole of what is clickable: put on the button it pops over the title of
                  the task, which is a line of the user's own text with nothing to explain, and
                  what pops there is an offer to edit that covers the thing being read. On the
                  pencil it is where the eye already is when the question comes up. An aria-label
                  says the same to whoever is not looking at either. */}
              <button
                type="button"
                onClick={title.start}
                aria-label={t('web.pages.projects.task.editTitle')}
                className="group flex w-full min-w-0 items-start gap-1.5 text-left"
              >
                <span className="font-medium text-gray-900 line-clamp-2">{task.title}</span>
                <span
                  title={t('web.pages.projects.task.editTitle')}
                  className="hidden sm:block flex-shrink-0 mt-1"
                >
                  <Pencil size={12} className="text-gray-300
                    group-hover:text-gray-600 transition-colors" />
                </span>
              </button>
            </h4>
          )}
          {/* The pill is the button: a priority is one of four words and picking between them is
              the whole of the edit, so there is nothing for a pencil to open that the pill does
              not open itself. A task that is done keeps the plain pill, having no priority left
              to change. */}
          {canReprioritize ? (
            <button
              ref={priorityRef}
              type="button"
              onClick={() => setPickingPriority(v => !v)}
              title={t('web.pages.projects.task.editPriority')}
              className={`${pill} flex-shrink-0 hover:ring-1 hover:ring-gray-300 transition-shadow`}
            >
              {t(`web.common.priority.${task.priority}`)}
            </button>
          ) : (
            <span className={pill}>{t(`web.common.priority.${task.priority}`)}</span>
          )}
          {canMoveStatus && (
            // The word is on the span rather than on the button, which is the only way it is read
            // when there is most to say: a disabled control gets no mouse events in Chrome, so no
            // tooltip of its own pops, and why the button is dead is exactly what is written here.
            <span
              title={t(`web.pages.projects.task.status.${running ? 'locked' : 'menu'}`)}
              className="flex-shrink-0"
            >
              <button
                ref={statusRef}
                type="button"
                onClick={() => setMovingStatus(v => !v)}
                disabled={running}
                aria-label={t('web.pages.projects.task.status.menu')}
                className="p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100
                  disabled:cursor-not-allowed disabled:hover:text-gray-300 disabled:hover:bg-transparent
                  transition-colors"
              >
                <MoreHorizontal size={16} />
              </button>
            </span>
          )}
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
              aria-label={t('web.pages.projects.task.editDescription')}
              className="group flex w-full min-w-0 items-start gap-1.5 text-left"
            >
              <span className="line-clamp-2">{task.description}</span>
              <span
                title={t('web.pages.projects.task.editDescription')}
                className="hidden sm:block flex-shrink-0 mt-0.5"
              >
                <Pencil size={12} className="text-gray-300
                  group-hover:text-gray-600 transition-colors" />
              </span>
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
          {/* Beside whoever the work is with, that being what it says: the work is running at this
              moment, whether in a subagent of theirs or in their own hands.

              Off while the task is being read over. The work is still on -- a reading is of work
              that has not been handed back, and the run holding it keeps its hold -- but two lines
              of the card spinning at once read as two things happening, and the one that is really
              happening is the reading. The reviewer's line carries it, and this one waits. */}
          {running && !reviewing && (
            <span title={t('web.pages.projects.task.running')} className="flex-shrink-0">
              <Loader2 size={14} className="text-cyan-500 animate-spin" />
            </span>
          )}
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
          {/* The way to a review, on a card that has none. Only while the task is still todo, that
              being the whole of when a reviewer can be put on or taken off, and gone from a card
              that never had one the moment the work begins: what is not there to be set is not
              worth a word on every card of the board. */}
          {!task.reviewer && canReassign && (
            <button
              ref={reviewerPencilRef}
              type="button"
              onClick={(e) => { e.stopPropagation(); setPickingReviewer(v => !v); }}
              title={t('web.pages.projects.task.review.addHint')}
              className="flex-shrink-0 px-1 rounded text-[11px] text-gray-300 hover:text-gray-600
                hover:bg-gray-100 transition-colors"
            >
              + {t('web.pages.projects.task.review.add')}
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

        {/* The reading, under whoever the work is with. Drawn from the name on the task rather than
            from the agent it was looked up to: an agent that has left the company is still who this
            task waits for, and a row that vanished with them would leave the gate unexplained. */}
        {task.reviewer && (
          <div className="mt-1 flex items-center gap-2">
            <div className="inline-flex items-center gap-2 p-1 -ml-1">
              <div className={`w-6 h-6 rounded-full ${avatarBG} flex items-center justify-center text-xs`}>
                {reviewer?.avatar ?? '👤'}
              </div>
              <span className="text-xs text-gray-600">{reviewer?.name ?? task.reviewer}</span>
              <span className="text-[10px] text-gray-400">
                {t('web.pages.projects.task.review.role')}
              </span>
            </div>
            {/* Beside the reviewer, the way the work spins beside whoever it is with. Out at the
                end of the row it reads as something the card is doing rather than something that
                agent is doing, and this row has a verdict of its own to end with. */}
            {reviewing && (
              <span title={t('web.pages.projects.task.review.running')} className="flex-shrink-0">
                <Loader2 size={14} className="text-cyan-500 animate-spin" />
              </span>
            )}
            {canReassign && (
              <button
                ref={reviewerPencilRef}
                type="button"
                onClick={() => setPickingReviewer(v => !v)}
                title={t('web.pages.projects.task.review.edit')}
                aria-label={t('web.pages.projects.task.review.edit')}
                className="flex-shrink-0 p-1 -ml-1 rounded text-gray-300 hover:text-gray-600
                  hover:bg-gray-100 transition-colors"
              >
                <Pencil size={12} />
              </button>
            )}
            <div className='flex-1'></div>
            {/* A waived review is the user's own hand on the task and has no report to open. */}
            {task.review?.verdict === 'waived' && (
              <span className="flex-shrink-0 text-[11px] text-gray-400">
                {t('web.pages.projects.task.review.waived')}
              </span>
            )}
            {/* Named apart from the report of the task itself, which is also what it downloads as:
                two reports of one task saved under one file name is the same file twice.

                The one word, whichever way the verdict went, and the icon a report gets anywhere on
                this board. The verdict is in the report and is read where it is explained: a task
                closes on the first verdict either way, so a rejection on the card would mark work
                already finished with a fault and offer nothing to be done about it. What the
                reviewer found is a paragraph, and the paragraph is a click away. */}
            {task.review?.output && (
              <TaskOutput
                output={task.review.output}
                title={`${task.title}-review`}
                modalTitle={t('web.pages.projects.task.review.report')}
                label={t('web.pages.projects.task.review.report')}
                icon={<FileText size={14} />}
              />
            )}
          </div>
        )}

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

      {pickingReviewer && (
        <AssigneePicker
          agents={activeAgents}
          selectedId={task.reviewer}
          noneLabel={t('web.pages.projects.task.review.none')}
          anchorRef={reviewerPencilRef}
          onPick={handleReviewerPick}
          onClose={() => setPickingReviewer(false)}
        />
      )}

      {pickingPriority && (
        <PriorityPicker
          selected={task.priority}
          anchorRef={priorityRef}
          onPick={handlePriorityPick}
          onClose={() => setPickingPriority(false)}
        />
      )}

      {movingStatus && (
        <TaskStatusMenu
          status={task.status}
          projectStarted={projectStarted}
          paused={!!task.pause}
          anchorRef={statusRef}
          onPick={handleStatusPick}
          onClose={() => setMovingStatus(false)}
        />
      )}
    </>
  );
}
