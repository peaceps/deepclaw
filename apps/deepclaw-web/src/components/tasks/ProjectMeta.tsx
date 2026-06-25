import { type Project, getProjectProgress, getProjectStatus } from '@deepclaw/core';
import { CheckCircle2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getProjectStatusStyles } from '../styles-mapping';
import { ProgressBar } from '@/laf/progress-bar';

export function ProjectMeta({ project }: { project: Project }) {
  const {t} = useTranslation();
  const totalTasks = Object.keys(project.tasks).length;
  const inProgressTasks = project.ongoingTasks.length;
  const completedTasks = project.completedTasks.length;
  const progress = getProjectProgress(project);

  return (
    <>
      <ProgressBar value={progress ?? 0} size="md" className="hidden sm:block w-32" />
      <div className="flex items-center gap-3 sm:gap-4 text-sm">
        {inProgressTasks > 0 && <div className="flex items-center gap-1.5 text-gray-600">
          <Clock size={16} className="text-yellow-500" />
          <span>{inProgressTasks}</span>
        </div>}
        <div className="flex items-center gap-1.5 text-gray-600">
          <CheckCircle2 size={16} className="text-green-500" />
          <span>{completedTasks}/{totalTasks}</span>
        </div>
      </div>
      <span className={
        `px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 ${getProjectStatusStyles(project)}`
      }>
        {t(`pages.projects.status.${getProjectStatus(project)}`)}
      </span>
    </>
  );
}
