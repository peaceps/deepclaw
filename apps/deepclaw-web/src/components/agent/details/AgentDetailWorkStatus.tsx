import { InfoCard } from "@/laf/info-card";
import { AgentEmployee } from "@deepclaw/core";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { priorityStyles} from '../../styles-mapping';
import { getProjectProgress } from "@/components/component-utils";
import { useAppStore } from "@/lib/store";

export function AgentDetailWorkStatus({ agent }: { agent: AgentEmployee }) {
  const {t} = useTranslation();
  const { getOneOngoingProject } = useAppStore();
  const currentProject = agent.id ? getOneOngoingProject(agent.id) : null;
  const progress = getProjectProgress(currentProject);

  return (
    <InfoCard title="pages.agents.details.workStatus.title" icon={<Target size={20} />} color="lime">
      <div className="space-y-4">
        {/* 当前项目 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">
            {t('pages.agents.details.workStatus.currentProject')}
          </label>
          {currentProject ? (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{currentProject.title}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  priorityStyles[currentProject.priority]
                }`}>
                  {t(`common.priority.${currentProject.priority}`)}
                </span>
              </div>
              <p className="text-sm text-gray-600 line-clamp-2">{currentProject.description}</p>
              {progress !== null && <>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>{t('pages.projects.project.progress')}: {progress}%</span>
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              </>}
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">
              {t('pages.agents.details.workStatus.noProject')}
            </div>
          )}
        </div>

      </div>
    </InfoCard>
  );
}
