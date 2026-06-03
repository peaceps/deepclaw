'use client';

import { useAppStore } from '@/lib/store';
import { TaskCard } from './TaskCard';
import { Folder, CheckCircle2, Clock, Users, ChevronDown, ChevronRight, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Project } from '@/types';

const columns = [
  { id: 'backlog', title: '📥 待规划', color: 'bg-gray-50' },
  { id: 'todo', title: '📋 待办', color: 'bg-blue-50' },
  { id: 'in_progress', title: '🔄 进行中', color: 'bg-yellow-50' },
  { id: 'review', title: '👀 审核中', color: 'bg-purple-50' },
  { id: 'done', title: '✅ 已完成', color: 'bg-green-50' },
];

interface ProjectRowProps {
  project: Project;
  isExpanded: boolean;
  onToggle: () => void;
}

function ProjectRow({ project, isExpanded, onToggle }: ProjectRowProps) {
  const completedTasks = project.tasks.filter(t => t.status === 'done').length;
  const inProgressTasks = project.tasks.filter(t => t.status === 'in_progress').length;
  const totalTasks = project.tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 项目头部 - 可点击展开/收起 */}
      <div
        onClick={onToggle}
        className="px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* 展开图标 */}
            <div className="text-gray-400 flex-shrink-0">
              {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </div>

            {/* 项目图标 */}
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
              <Folder size={20} />
            </div>

            {/* 项目信息 */}
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate">{project.name}</h3>
              <p className="text-sm text-gray-500 truncate hidden sm:block">{project.description}</p>
            </div>
          </div>

          {/* 右侧统计 */}
          <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
            {/* 负责人 */}
            <div className="flex items-center gap-1.5 text-sm bg-purple-50 px-2 py-1 rounded-lg">
              <User size={16} className="text-purple-500" />
              <span className="text-gray-500">负责人:</span>
              <span className="font-medium text-purple-700">{project.owner.name}</span>
            </div>

            {/* 进度条 - 移动端隐藏 */}
            <div className="hidden sm:block w-32">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>进度</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* 统计数字 */}
            <div className="flex items-center gap-3 sm:gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Users size={16} className="text-blue-500" />
                <span>{project.memberIds.length}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-600">
                <CheckCircle2 size={16} className="text-green-500" />
                <span>{completedTasks}/{totalTasks}</span>
              </div>
              {inProgressTasks > 0 && (
                <div className="flex items-center gap-1.5 text-gray-600">
                  <Clock size={16} className="text-yellow-500" />
                  <span>{inProgressTasks}</span>
                </div>
              )}
            </div>

            {/* 状态标签 */}
            <span className={`
              px-3 py-1 rounded-full text-xs font-medium flex-shrink-0
              ${project.status === 'active' ? 'bg-green-100 text-green-700' : ''}
              ${project.status === 'paused' ? 'bg-yellow-100 text-yellow-700' : ''}
              ${project.status === 'completed' ? 'bg-blue-100 text-blue-700' : ''}
            `}>
              {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : project.status === 'completed' ? '已完成' : '已归档'}
            </span>
          </div>
        </div>
      </div>

      {/* 展开的任务看板 */}
      {isExpanded && (
        <div className="p-4 bg-gray-50/50">
          {project.tasks.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <p>该项目暂无任务</p>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400" style={{ minWidth: '100%' }}>
              {columns.map((column) => {
                const columnTasks = project.tasks.filter((t) => t.status === column.id);

                return (
                  <div
                    key={column.id}
                    className={`w-full sm:w-64 ${column.color} rounded-lg p-3 flex-shrink-0`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-gray-800 text-sm">{column.title}</h4>
                      <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">
                        {columnTasks.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {columnTasks.map((task) => (
                        <TaskCard key={task.id} task={task} />
                      ))}
                    </div>

                    {columnTasks.length === 0 && (
                      <div className="text-center py-6 text-gray-400 text-xs">
                        暂无任务
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskBoard() {
  const { projects } = useAppStore();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() =>
    new Set([projects[0]?.id]) // 默认展开第一个项目
  );

  // 当 projects 变化时，确保至少有一个项目被展开
  useEffect(() => {
    setExpandedProjects(prev => {
      // 如果当前没有展开的项目，或者展开的项目都不在新的 projects 列表中
      const validExpanded = new Set(
        Array.from(prev).filter(id => projects.some(p => p.id === id))
      );
      // 如果没有有效的展开项目，展开第一个
      if (validExpanded.size === 0 && projects.length > 0) {
        validExpanded.add(projects[0].id);
      }
      return validExpanded;
    });
  }, [projects]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* 页面头部 */}
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900">项目任务</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} 个项目，管理所有任务</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <CheckCircle2 size={16} className="text-green-500" />
            {projects.reduce((sum, p) => sum + p.tasks.filter(t => t.status === 'done').length, 0)} 已完成
          </span>
          <span className="flex items-center gap-1">
            <Clock size={16} className="text-yellow-500" />
            {projects.reduce((sum, p) => sum + p.tasks.filter(t => t.status === 'in_progress').length, 0)} 进行中
          </span>
        </div>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            isExpanded={expandedProjects.has(project.id)}
            onToggle={() => toggleProject(project.id)}
          />
        ))}
      </div>
    </div>
  );
}
