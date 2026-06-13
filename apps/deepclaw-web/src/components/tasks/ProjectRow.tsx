import type { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import { ChevronDown, ChevronRight, Folder, User, CheckCircle2, Clock } from 'lucide-react';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { useTranslation } from 'react-i18next';
import { ProjectTasks } from './ProjectTasks';

type ProjectRowProps = {
    project: Project<Task>; agents: AgentEmployee[]; isExpanded: boolean; onToggle: () => void;
}

export function ProjectRow({ project, agents, isExpanded, onToggle }: ProjectRowProps) {
  const totalTasks = Object.keys(project.tasks).length;
  const inProgressTasks = project.ongoingTasks!.length;
  const completedTasks = project.completedTasks!.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const agent = agents.find(a => project.creator === a.id);
  const {t} = useTranslation();

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div onClick={onToggle} className="px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-gray-400 flex-shrink-0">{isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}</div>
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0"><Folder size={20} /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate">{project.title}</h3>
              <p className="text-sm text-gray-500 truncate hidden sm:block">{project.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm bg-purple-50 px-2 py-1 rounded-lg"><User size={16} className="text-purple-500" /><span className="text-gray-500">{t('pages.projects.project.owner')}:</span><span className="font-medium text-purple-700">{project.creator}</span></div>
            <div className="hidden sm:block w-32">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span>{t('pages.projects.project.progress')}</span><span>{progress}%</span></div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600"><CheckCircle2 size={16} className="text-green-500" /><span>{completedTasks}/{totalTasks}</span></div>
              {inProgressTasks > 0 && <div className="flex items-center gap-1.5 text-gray-600"><Clock size={16} className="text-yellow-500" /><span>{inProgressTasks}</span></div>}
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 ${!project.closedAt && !project.ongoingTasks!.length ? 'bg-gray-100 text-gray-700' : ''} ${!project.closedAt && !!project.ongoingTasks!.length ? 'bg-green-100 text-green-700' : ''} ${!!project.closedAt ? 'bg-blue-100 text-blue-700' : ''}`}>{!!project.closedAt ? t('pages.projects.status.done') : (!project.ongoingTasks!.length ? t('pages.projects.status.todo') : t('pages.projects.status.ongoing'))}</span>
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="flex flex-col lg:flex-row border-t border-gray-200" style={{ minHeight: '400px' }}>
          <ProjectTasks project={project} agents={agents}/>
          <div className="flex-1 border-t lg:border-t-0 lg:border-l border-gray-200 min-h-140">
            <ChatSidebar
                from={'project'}
                agent={agent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
