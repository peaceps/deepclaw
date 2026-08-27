import { type SlimProject, PROJECT_CONFIG } from '@deepclaw/core';
import { CalendarDays, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { useTranslation } from 'react-i18next';
import { memo, useCallback, useRef } from 'react';
import { ProjectTasks } from './ProjectTasks';
import { formatDate } from '@/components/component-utils';
import { useAppStore } from '@/lib/store';
import { EditableLabels } from '@/laf/editable-labels';
import { updateProjectTags } from '@/server/data';
import { ProjectOwner } from './ProjectOwner';
import { ProjectMeta } from './ProjectMeta';

type ProjectRowProps = {
    project: SlimProject; isExpanded: boolean; onToggle: (projectId: string) => void;
}

/**
 * One project on the board, folded to its header until it is opened.
 *
 * Held back from re-rendering while what it is handed stays the same. A run says what step it is
 * on often, and each of those replaces the array of projects while leaving every project but one
 * the object it already was: without this, a board of any length redraws every header at that
 * rate, the folded ones and the ones off the screen along with the rest.
 *
 * Which makes the three props above a thing to keep still. The project comes out of the store
 * already doing that, and the toggle is asked for the id rather than closed over it, so that the
 * board hands one function to every row instead of one to each -- a lambda per row would undo all
 * of this. It rests in turn on the setter naming which row is open, which is built to hold still
 * for the same reason: one rebuilt each time a row is folded would carry the whole board with it.
 */
export const ProjectRow = memo(function ProjectRow(
  { project, isExpanded, onToggle }: ProjectRowProps
) {
  const updateProject = useAppStore(s => s.updateProject);
  const ownerAgent = useAppStore(s => s.agents.find(a => a.id === project.creator));
  const tagsRef = useRef<HTMLDivElement>(null);
  const skipToggleRef = useRef(false);
  const {t, i18n} = useTranslation();
  const onTagsChange = useCallback((tags: string[]) => {
    const previousTags = project.tags;
    updateProject({ ...project, tags });
    updateProjectTags(project.id, tags).catch(() => {
      updateProject({ ...project, tags: previousTags });
    });
  }, [project, updateProject]);

  // Owner click stops propagation, so handleToggle never consumes the flag set
  // on mousedown; clear it here to avoid swallowing the next header click.
  const clearSkipToggle = useCallback(() => {
    skipToggleRef.current = false;
  }, []);

  // mousedown fires before focus leaves the tag input, so we detect an active
  // tag editor here and skip the toggle that the following click would trigger.
  const handleHeaderMouseDown = useCallback((event: React.MouseEvent) => {
    if (tagsRef.current?.contains(event.target as Node)) {
      return;
    }
    const active = document.activeElement;
    const editingTag = active instanceof HTMLElement && !!tagsRef.current?.contains(active);
    skipToggleRef.current = editingTag;
    if (editingTag) {
      active.blur();
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (skipToggleRef.current) {
      skipToggleRef.current = false;
      return;
    }
    onToggle(project.id);
  }, [onToggle, project.id]);

  return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div
          onMouseDown={handleHeaderMouseDown}
          onClick={handleToggle}
          className="px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
              <div className="text-gray-400 flex-shrink-0">
                {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </div>
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-500 to-emerald-600 flex items-center justify-center text-white flex-shrink-0">
                <Folder size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                  <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate min-w-0">
                    {project.title}
                  </h3>
                  <div
                    ref={tagsRef}
                    className="hidden sm:block flex-shrink-0 max-w-[60%]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EditableLabels
                      labels={project.tags ?? []}
                      onChange={onTagsChange}
                      color="sky"
                      size="small"
                      maxLabelCount={PROJECT_CONFIG.maxTagCount}
                      maxLabelTextLength={PROJECT_CONFIG.maxTagTextLength}
                      placeholder={t('web.pages.projects.project.labels.save')}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                  <CalendarDays size={12} className="flex-shrink-0" />
                  <span>{formatDate(i18n.language, project.createdAt)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
              <ProjectOwner
                ownerAgent={ownerAgent}
                fallbackName={project.creator}
                onInteract={clearSkipToggle}
              />
              <ProjectMeta project={project} />
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="flex flex-col lg:flex-row border-t border-gray-200 min-h-[400px] lg:max-h-[600px]">
            <ProjectTasks project={project}/>
            <div className="flex-1 min-w-0 border-t lg:border-t-0 lg:border-l border-gray-200">
              {ownerAgent && <ChatSidebar
                projectId={project.id}
                agent={ownerAgent}
              />}
            </div>
          </div>
        )}
      </div>
  );
});
