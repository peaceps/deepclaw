import { InfoCard } from "@/laf/info-card";
import { ProgressBar } from "@/laf/progress-bar";
import { type AgentEmployee, getTaskProgress, type RunningTask, type Task } from "@deepclaw/core";
import { Activity, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { priorityStyles } from '../../styles-mapping';
import { useAppStore } from "@/lib/store";
import { useProjectTasks } from "@/lib/use-project-tasks";
import { formatDate } from "@/components/component-utils";

export function AgentDetailRunningTasks({ agent }: { agent: AgentEmployee }) {
  const {t, i18n} = useTranslation();
  const runningTasks = useAppStore(s => s.runningTasks);
  const projects = useAppStore(s => s.projects);
  const runs = runningTasks
    .filter(run => run.agentId === agent.id)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // A run names a task, and the projects arrive here holding none: the ones being run in are asked
  // for, which is however many tasks are under way rather than however many projects there are.
  useProjectTasks([...new Set(runs.map(run => run.projectId))]);

  return (
    <InfoCard title="web.pages.agents.details.runningTasks.title" icon={<Activity size={20} />} color="cyan">
      {runs.length > 0 ? (
        // Room for about three runs, the rest is a scroll away so the card stays a card.
        <div className="space-y-3 max-h-[420px] overflow-y-auto">
          {runs.map(run => (
            <RunningTaskRow
              key={run.runId}
              run={run}
              task={projects.find(project => project.id === run.projectId)?.tasks?.[run.taskId]}
              startedAt={formatDate(i18n.language, run.startedAt)}
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic">
          {t('web.pages.agents.details.runningTasks.noTask')}
        </div>
      )}
    </InfoCard>
  );
}

/**
 * A run outlives nothing but the process, while the task it points at is stored: a plan rewritten
 * under a run leaves it pointing at nothing, and then the run is still worth showing on its own.
 */
function RunningTaskRow({run, task, startedAt}: {
  run: RunningTask; task?: Task; startedAt: string;
}) {
  const {t} = useTranslation();
  const progress = task ? getTaskProgress(task) : null;
  // The id is no name for a user to read, it only stands in where the task itself is gone.
  const label = task?.title ?? run.taskId;

  return (
    <Link
      href={`/projects?project=${encodeURIComponent(run.projectId)}`}
      className="block bg-gray-50 rounded-lg p-3 cursor-pointer transition-colors
        hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2"
      aria-label={`${t('web.pages.agents.details.runningTasks.title')}: ${label}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse flex-shrink-0" />
          <span className="font-medium text-gray-900 truncate">{label}</span>
        </span>
        {task && (
          <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
            priorityStyles[task.priority]
          }`}>
            {t(`web.common.priority.${task.priority}`)}
          </span>
        )}
      </div>
      {task && <p className="text-sm text-gray-600 line-clamp-2">{task.description}</p>}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
        <CalendarDays size={12} />
        <span>{t('web.pages.agents.details.runningTasks.startedAt', {time: startedAt})}</span>
      </div>
      {progress !== null && (
        <ProgressBar value={progress} size="sm" showLabel={false} className="mt-2" />
      )}
    </Link>
  );
}
