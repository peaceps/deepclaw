'use client';
import type { Project } from "@deepclaw/loop-gateway";
import { useTranslation } from "react-i18next";
import { getProjectProgress } from "../component-utils";

export function AgentCurrentProject({ project }: { project: Project }) {
    const {t} = useTranslation();
    if (!project) return null;
    
    const progress = getProjectProgress(project);
  
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 mb-1">{t('pages.agents.details.workStatus.currentProject')}</p>
        <p className="text-sm font-medium text-gray-700 truncate">{project.title}</p>
        {progress !== null && <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>}
      </div>
    );
}
