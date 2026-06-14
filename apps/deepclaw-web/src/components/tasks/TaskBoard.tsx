'use client';

import { CheckCircle2, Clock} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import {ProjectRow} from './ProjectRow';
import { useTranslation } from 'react-i18next';
import { getProjectStatus } from '../component-utils';

export function TaskBoard({projects, agents}: {projects: Project<Task>[], agents: AgentEmployee[]}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set([projects[0]?.id]));
  const {t} = useTranslation();

  useEffect(() => {
    setTimeout(() => 
      setExpandedProjects(prev => {
        const validExpanded = new Set(Array.from(prev).filter(id => projects.some(p => p.id === id)));
        if (validExpanded.size === 0 && projects.length > 0) validExpanded.add(projects[0].id);
        return validExpanded;
      })
    );
  }, [projects]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-gray-100">
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-gray-200
        flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">{t('pages.projects.projectList')}</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} {t('pages.projects.count')}</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <CheckCircle2 size={16} className="text-green-500" />
            {projects.filter(p => getProjectStatus(p) === 'done').length} {t('pages.projects.status.done')}
          </span>
          <span className="flex items-center gap-1">
            <Clock size={16} className="text-yellow-500" />
            {projects.filter(p => getProjectStatus(p) !== 'done').length} {t('pages.projects.status.ongoing')}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {projects.map(project => (
          <ProjectRow key={project.id} project={project} agents={agents}
            isExpanded={expandedProjects.has(project.id)} onToggle={() => toggleProject(project.id)}
          />
        ))}
      </div>
    </div>
  );
}
