'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {ProjectRow} from './ProjectRow';
import { useTranslation } from 'react-i18next';
import { ProjectSearch, DEFAULT_PROJECT_FILTERS, filterProjects } from './ProjectSearch';

export function TaskBoard() {
  const { projects } = useAppStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [filters, setFilters] = useState(DEFAULT_PROJECT_FILTERS);
  const filteredProjects = useMemo(() => filterProjects(projects, filters), [projects, filters]);
  const {t} = useTranslation();

  const projectIdsKey = projects.map(p => p.id).join(',');
  const [prevProjectIdsKey, setPrevProjectIdsKey] = useState(projectIdsKey);
  if (projectIdsKey !== prevProjectIdsKey) {
    setPrevProjectIdsKey(projectIdsKey);
    setExpandedProjects(prev => {
      return new Set(Array.from(prev).filter(id => projects.some(p => p.id === id)));
    });
  }

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-gray-100">
      <div className="px-2 py-1 lg:pb-4 bg-white border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 lg:gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">{t('pages.projects.projectList')}</h1>
          </div>
        </div>
        <ProjectSearch filters={filters} onChange={setFilters}/>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredProjects.length ? filteredProjects.map(project => (
          <ProjectRow key={project.id} project={project}
            isExpanded={expandedProjects.has(project.id)} onToggle={() => toggleProject(project.id)}
          />
        )) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400">
            <p className="text-sm">{t('pages.projects.search.noResults')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
