import { Project, Task, AgentEmployee } from '@/types';
import { ChevronDown, ChevronRight, Folder, User, CheckCircle2, Clock } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { useTranslation } from 'react-i18next';

const columns = [
  { id: 'todo', icon: '📋', title: 'pages.projects.status.todo', color: 'bg-blue-50' },
  { id: 'ongoing', icon: '🔄', title: 'pages.projects.status.ongoing', color: 'bg-yellow-50' },
  { id: 'done', icon: '✅', title: 'pages.projects.status.done', color: 'bg-green-50' },
];

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
        <div className="flex flex-col lg:flex-row" style={{ minHeight: '400px' }}>
          <div className="flex-1 p-4 bg-gray-50/50 overflow-x-auto">
            {Object.keys(project.tasks).length === 0 ? (
              <div className="py-8 text-center text-gray-400"><p>{t('pages.projects.project.noTasks')}</p></div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-3">
                {columns.map(column => {
                  const columnTasks = Object.values(project.tasks).filter(task => task.status === column.id);
                  return (
                    <div key={column.id} className={`w-full lg:w-64 ${column.color} rounded-lg p-3 flex-shrink-0`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-gray-800 text-sm">{column.icon} {t(column.title)}</h4>
                        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">{columnTasks.length}</span>
                      </div>
                      <div className="space-y-2">
                        {columnTasks.map(task => <TaskCard 
                            key={task.title} task={task} 
                            assignee={agents.find(agent => agent.id === task.assignee)}
                        />)}
                      </div>
                      {columnTasks.length === 0 && <div className="text-center py-6 text-gray-400 text-xs">{t('pages.projects.project.noTasksAtStatus')}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-gray-200">
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
