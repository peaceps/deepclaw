import { InfoCard } from "@/laf/info-card";
import { ProgressBar } from "@/laf/progress-bar";
import { type AgentEmployee, getProjectProgress, getProjectStatus } from "@deepclaw/core";
import { CalendarDays, Target } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { priorityStyles} from '../../styles-mapping';
import { useAppStore } from "@/lib/store";
import { formatDate } from "@/components/component-utils";

export function AgentDetailWorkStatus({ agent }: { agent: AgentEmployee }) {
  const {t, i18n} = useTranslation();
  const projects = useAppStore(s => s.projects);
  const currentProjects = agent.id
    ? projects
        .filter(p => p.creator === agent.id && getProjectStatus(p) !== 'done')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <InfoCard title="web.pages.agents.details.workStatus.title" icon={<Target size={20} />} color="lime">
      <div className="space-y-4">
        {/* 当前项目 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">
            {t('web.pages.agents.details.workStatus.currentProject')}
          </label>
          {currentProjects.length > 0 ? (currentProjects.map(currentProject => {
            const progress = getProjectProgress(currentProject);
            return <Link
              href={`/projects?project=${encodeURIComponent(currentProject.id)}`}
              className="block bg-gray-50 rounded-lg p-3 mt-4 cursor-pointer transition-colors
                hover:bg-gray-100 focus:outline-none
                focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
              key={currentProject.id}
              aria-label={`${t('web.pages.projects.projectList')}: ${currentProject.title}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{currentProject.title}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  priorityStyles[currentProject.priority]
                }`}>
                  {t(`web.common.priority.${currentProject.priority}`)}
                </span>
              </div>
              <p className="text-sm text-gray-600 line-clamp-2">{currentProject.description}</p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                <CalendarDays size={12} />
                <span>{formatDate(i18n.language, currentProject.createdAt)}</span>
              </div>
              {progress !== null && <>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>{t('web.pages.projects.project.progress')}: {progress}%</span>
              </div>
              <ProgressBar value={progress} size="sm" showLabel={false} className="mt-2" />
              </>}
            </Link>})
          ) : (
            <div className="text-sm text-gray-400 italic">
              {t('web.pages.agents.details.workStatus.noProject')}
            </div>
          )}
        </div>

      </div>
    </InfoCard>
  );
}
