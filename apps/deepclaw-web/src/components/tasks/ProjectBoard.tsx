'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {ProjectRow} from './ProjectRow';
import { useTranslation } from 'react-i18next';
import { getProjectStatus } from '@deepclaw/core';
import { ProjectSearch, DEFAULT_PROJECT_FILTERS, filterProjects } from './ProjectSearch';

export function ProjectBoard({ selectedProjectId }: { selectedProjectId?: string }) {
  const projects = useAppStore(s => s.projects);
  const selectedProject = selectedProjectId
    ? projects.find(project => project.id === selectedProjectId)
    : undefined;
  const projectRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastScrolledProjectIdRef = useRef<string | undefined>(undefined);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(selectedProjectId ? [selectedProjectId] : [])
  );
  const [handledSelectedProjectId, setHandledSelectedProjectId] = useState<string | undefined>();
  const [filters, setFilters] = useState(DEFAULT_PROJECT_FILTERS);
  const filteredProjects = useMemo(
    () => [...filterProjects(projects, filters)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [projects, filters]
  );
  const {t} = useTranslation();

  if (!selectedProjectId && handledSelectedProjectId) {
    setHandledSelectedProjectId(undefined);
  } else if (selectedProjectId && selectedProject && selectedProjectId !== handledSelectedProjectId) {
    setHandledSelectedProjectId(selectedProjectId);
    setExpandedProjects(prev => {
      if (prev.has(selectedProjectId)) return prev;
      const next = new Set(prev);
      next.add(selectedProjectId);
      return next;
    });
    if (filterProjects([selectedProject], filters).length === 0) {
      setFilters({
        ...DEFAULT_PROJECT_FILTERS,
        status: getProjectStatus(selectedProject),
      });
    }
  }

  const projectIdsKey = projects.map(p => p.id).join(',');
  const [prevProjectIdsKey, setPrevProjectIdsKey] = useState(projectIdsKey);
  if (projectIdsKey !== prevProjectIdsKey) {
    setPrevProjectIdsKey(projectIdsKey);
    setExpandedProjects(prev => {
      return new Set(Array.from(prev).filter(id => projects.some(p => p.id === id)));
    });
  }

  useEffect(() => {
    if (!selectedProjectId) {
        lastScrolledProjectIdRef.current = undefined;
        return;
    }
    if (!expandedProjects.has(selectedProjectId)) return;
    if (lastScrolledProjectIdRef.current === selectedProjectId) return;

    const projectElement = projectRefs.current[selectedProjectId];
    if (!projectElement) return;

    const frame = requestAnimationFrame(() => {
      lastScrolledProjectIdRef.current = selectedProjectId;
      projectElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [expandedProjects, filteredProjects, selectedProjectId]);

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
          <div
            key={project.id}
            ref={element => {
              projectRefs.current[project.id] = element;
            }}
          >
            <ProjectRow project={project}
              isExpanded={expandedProjects.has(project.id)} onToggle={() => toggleProject(project.id)}
            />
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400">
            <p className="text-sm">{t('pages.projects.search.noResults')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
