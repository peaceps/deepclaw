'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { splitLoopId } from '@deepclaw/core';
import { useAppStore } from '@/lib/store';
import {ProjectRow} from './ProjectRow';
import { useTranslation } from 'react-i18next';
import {
  ProjectSearch, ALL_PROJECT_FILTERS, DEFAULT_PROJECT_FILTERS, filterProjects
} from './ProjectSearch';
import { usePersistentString } from '@/lib/use-persistent-state';

export function ProjectBoard({ selectedProjectId }: { selectedProjectId?: string }) {
  const projects = useAppStore(s => s.projects);
  const openChatCall = useAppStore(s => s.openChatCall);
  const selectedProject = selectedProjectId
    ? projects.find(project => project.id === selectedProjectId)
    : undefined;
  const calledProject = openChatCall
    ? projects.find(project => project.id === splitLoopId(openChatCall.loopId).projectId)
    : undefined;
  const projectRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastScrolledProjectIdRef = useRef<string | undefined>(undefined);
  const [expandedProjectId, setExpandedProjectId] = usePersistentString('projects.expandedId');
  const [handledSelectedProjectId, setHandledSelectedProjectId] = useState<string | undefined>();
  const [answeredCall, setAnsweredCall] = useState(0);
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
    setExpandedProjectId(selectedProjectId);
    // A link names the project to show, so a view it falls outside of gives way rather than the link.
    if (filterProjects([selectedProject], filters).length === 0) {
      setFilters(ALL_PROJECT_FILTERS);
    }
  }

  /**
   * A link only names the project, and naming the one the page already showed leaves it as it is:
   * the chat a click was sent to has to be there whatever the user folded away in between.
   */
  if (calledProject && openChatCall && openChatCall.seq !== answeredCall) {
    setAnsweredCall(openChatCall.seq);
    setExpandedProjectId(calledProject.id);
    if (filterProjects([calledProject], filters).length === 0) {
      setFilters(ALL_PROJECT_FILTERS);
    }
  }

  const projectIdsKey = projects.map(p => p.id).join(',');
  const [prevProjectIdsKey, setPrevProjectIdsKey] = useState(projectIdsKey);
  if (projectIdsKey !== prevProjectIdsKey) {
    setPrevProjectIdsKey(projectIdsKey);
    setExpandedProjectId(prev => (prev && projects.some(p => p.id === prev) ? prev : undefined));
  }

  useEffect(() => {
    if (!selectedProjectId) {
        lastScrolledProjectIdRef.current = undefined;
        return;
    }
    if (expandedProjectId !== selectedProjectId) return;
    if (lastScrolledProjectIdRef.current === selectedProjectId) return;

    const projectElement = projectRefs.current[selectedProjectId];
    if (!projectElement) return;

    const frame = requestAnimationFrame(() => {
      lastScrolledProjectIdRef.current = selectedProjectId;
      projectElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [expandedProjectId, filteredProjects, selectedProjectId]);

  const toggleProject = (projectId: string) => {
    setExpandedProjectId(prev => (prev === projectId ? undefined : projectId));
  };

  return (
    <div className="h-full flex flex-col bg-gray-100">
      <div className="px-2 py-1 lg:pb-4 bg-white border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 lg:gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">{t('web.pages.projects.projectList')}</h1>
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
              isExpanded={expandedProjectId === project.id} onToggle={() => toggleProject(project.id)}
            />
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400">
            <p className="text-sm">{t('web.pages.projects.search.noResults')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
