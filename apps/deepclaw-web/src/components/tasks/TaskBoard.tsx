'use client';

import { useAppStore } from '@/lib/store';
import {invoke} from '@/lib/invoke';
import { TaskCard } from './TaskCard';
import { Folder, CheckCircle2, Clock, Users, ChevronDown, ChevronRight, User, Send, MessageSquare, ChevronLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { AgentEmployee, Message, Project, Task } from '@/types';
import { formatDate } from '@/lib/utils';

const columns = [
  { id: 'todo', title: '📋 待办', color: 'bg-blue-50' },
  { id: 'ongoing', title: '🔄 进行中', color: 'bg-yellow-50' },
  { id: 'done', title: '✅ 已完成', color: 'bg-green-50' },
];

function ProjectChat({ project, agents, isCollapsed, onToggle }: { 
  project: Project<Task>; 
  agents: AgentEmployee[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Array<{ id: string; content: string; type: 'user' | 'agent'; timestamp: string }>>([]);
  const ownerAgent = agents.find(a => a.name === project.creator) || agents[0];

  const handleSend = async() => {
    if (!input.trim()) return;
    const userMsg = { id: Date.now().toString(), content: input, type: 'user' as const, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const r = await invoke(input);
    const ams = {
      id: (Date.now() + 1).toString(),
      content: r,
      type: 'agent' as const,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, ams]);
  };

  if (!ownerAgent) {
    return <div className={`border-l border-gray-200 bg-white flex flex-col ${isCollapsed ? 'w-12' : 'w-96'}`}><div className="flex-1 flex items-center justify-center text-gray-400"><p className="text-xs">暂无负责人</p></div></div>;
  }

  return (
    <div className={`border-gray-200 bg-white transition-all duration-300 flex flex-col min-h-0 ${isCollapsed ? 'w-12 h-12 lg:h-auto' : 'w-full lg:w-96 h-96 lg:h-full'}`}>
      <div className={`flex items-center border-b border-gray-200 bg-gray-50 ${isCollapsed ? 'justify-center py-3' : 'justify-between px-4 py-3'}`}>
        <button onClick={onToggle} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title={isCollapsed ? '展开' : '收起'}>
          {isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
        {!isCollapsed && <div className="flex items-center gap-2"><MessageSquare size={18} className="text-gray-600" /><span className="font-medium text-gray-700">项目对话</span></div>}
      </div>
      {!isCollapsed && (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xl">{ownerAgent.avatar}</div>
            <div><h3 className="font-semibold text-gray-900">{ownerAgent.name}</h3><p className="text-xs text-gray-500">{ownerAgent.role} · 项目负责人</p></div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400"><div className="text-4xl mb-3">💬</div><p className="text-sm">和项目负责人聊聊吧</p></div>
            ) : messages.map(m => (
              <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${m.type === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <p className="text-sm">{m.content}</p><p className={`text-xs mt-1 ${m.type === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>{formatDate(m.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-gray-100">
            <div className="flex gap-2 items-center">
              <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder={`给 ${ownerAgent.name} 发消息...`} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              <button onClick={handleSend} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"><Send size={18} /></button>
            </div>
          </div>
        </>
      )}
      {isCollapsed && <div className="flex-1 flex flex-col items-center py-4 space-y-4"><div className="text-gray-400"><MessageSquare size={20} /></div><div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-sm">{ownerAgent.avatar}</div></div>}
    </div>
  );
}

interface ProjectRowProps { project: Project<Task>; agents: AgentEmployee[]; isExpanded: boolean; onToggle: () => void; }

function ProjectRow({ project, agents, isExpanded, onToggle }: ProjectRowProps) {
  const totalTasks = Object.keys(project.tasks).length;
  const inProgressTasks = project.ongoingTasks!.length;
  const completedTasks = project.completedTasks!.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const [chatCollapsed, setChatCollapsed] = useState(false);

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
            <div className="flex items-center gap-1.5 text-sm bg-purple-50 px-2 py-1 rounded-lg"><User size={16} className="text-purple-500" /><span className="text-gray-500">负责人:</span><span className="font-medium text-purple-700">{project.creator}</span></div>
            <div className="hidden sm:block w-32">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span>进度</span><span>{progress}%</span></div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="flex items-center gap-3 sm:gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600"><CheckCircle2 size={16} className="text-green-500" /><span>{completedTasks}/{totalTasks}</span></div>
              {inProgressTasks > 0 && <div className="flex items-center gap-1.5 text-gray-600"><Clock size={16} className="text-yellow-500" /><span>{inProgressTasks}</span></div>}
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium flex-shrink-0 ${!project.closedAt && !project.ongoingTasks!.length ? 'bg-gray-100 text-gray-700' : ''} ${!project.closedAt && !!project.ongoingTasks!.length ? 'bg-green-100 text-green-700' : ''} ${!!project.closedAt ? 'bg-blue-100 text-blue-700' : ''}`}>{!!project.closedAt ? '已完成' : (!project.ongoingTasks!.length ? '未开始' : '进行中')}</span>
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="flex flex-col lg:flex-row" style={{ minHeight: '400px' }}>
          <div className="flex-1 p-4 bg-gray-50/50 overflow-x-auto">
            {Object.keys(project.tasks).length === 0 ? (
              <div className="py-8 text-center text-gray-400"><p>该项目暂无任务</p></div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-3">
                {columns.map(column => {
                  const columnTasks = Object.values(project.tasks).filter(t => t.status === column.id);
                  return (
                    <div key={column.id} className={`w-full lg:w-64 ${column.color} rounded-lg p-3 flex-shrink-0`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-gray-800 text-sm">{column.title}</h4>
                        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">{columnTasks.length}</span>
                      </div>
                      <div className="space-y-2">
                        {columnTasks.map(task => <TaskCard key={task.title} task={task} agents={agents} />)}
                      </div>
                      {columnTasks.length === 0 && <div className="text-center py-6 text-gray-400 text-xs">暂无任务</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t lg:border-t-0 lg:border-l border-gray-200">
            <ProjectChat project={project} agents={agents} isCollapsed={chatCollapsed} onToggle={() => setChatCollapsed(!chatCollapsed)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskBoard({projects, agents}: {projects: Project<Task>[], agents: AgentEmployee[]}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set([projects[0]?.id]));

  useEffect(() => {
    setExpandedProjects(prev => {
      const validExpanded = new Set(Array.from(prev).filter(id => projects.some(p => p.id === id)));
      if (validExpanded.size === 0 && projects.length > 0) validExpanded.add(projects[0].id);
      return validExpanded;
    });
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
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">项目任务</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} 个项目，管理所有任务</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1"><CheckCircle2 size={16} className="text-green-500" />{projects.filter(p => !!p.closedAt).length} 已完成</span>
          <span className="flex items-center gap-1"><Clock size={16} className="text-yellow-500" />{projects.filter(p => !p.closedAt).length} 进行中</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {projects.map(project => (
          <ProjectRow key={project.id} project={project} agents={agents} isExpanded={expandedProjects.has(project.id)} onToggle={() => toggleProject(project.id)} />
        ))}
      </div>
    </div>
  );
}
