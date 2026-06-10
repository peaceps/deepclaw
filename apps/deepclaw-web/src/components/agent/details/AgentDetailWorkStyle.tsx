import { InfoCard } from "./InfoCard";
import { AgentEmployee, Project, Task } from "@deepclaw/loop-gateway";
import { Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import {CheckCircle2} from 'lucide-react';
import {priorityTexts, priorityStyles} from '../../styles-mapping';
import { getProjectProgress } from "@/components/component-utils";

export function AgentDetailWorkStyle({ projects, agent }: { projects: Project<Task>[], agent: AgentEmployee }) {
  const {t} = useTranslation();
  const currentProject = agent.id ? projects.find(p => p.creator === agent.id) : null;
  const progress = getProjectProgress(currentProject);

  return (
    <InfoCard title={t('pages.agents.details.workStyle.title')} icon={<Target size={20} />}>
      <div className="space-y-4">
        {/* 当前项目 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.workStyle.currentProject')}</label>
          {currentProject ? (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{currentProject.title}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  priorityStyles[currentProject.priority]
                }`}>
                  {t(priorityTexts[currentProject.priority])}
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
            <div className="text-sm text-gray-400 italic">{t('pages.agents.details.workStyle.noProject')}</div>
          )}
        </div>

        {/* 工作状态说明 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.workStyle.workCharacteristics')}</label>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              <span>{t('pages.agents.details.workStyle.goodAt', {skills: agent.expertise?.join('/') || t('common.all')})}</span>
            </li>
          </ul>
        </div>
      </div>
    </InfoCard>
  );
}
