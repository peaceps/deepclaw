'use client';

import { useAppStore } from '@/lib/store';
import { Project } from '@/types';

interface ProjectOptionProps {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
}

function ProjectOption({ project, isSelected, onClick }: ProjectOptionProps) {
  const taskCount = project.tasks.length;
  const completedCount = project.tasks.filter(t => t.status === 'done').length;
  const progress = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
        isSelected
          ? 'bg-blue-50 border-2 border-blue-500'
          : 'bg-white border-2 border-transparent hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 truncate">{project.name}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                project.status === 'active'
                  ? 'bg-green-100 text-green-700'
                  : project.status === 'paused'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : project.status === 'completed' ? '已完成' : '已归档'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1 truncate">{project.description}</p>
        </div>
        <div className="ml-4 text-right">
          <div className="text-sm font-medium text-gray-700">{completedCount}/{taskCount}</div>
          <div className="text-xs text-gray-500">{progress}%</div>
        </div>
      </div>
      {/* 进度条 */}
      <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </button>
  );
}

export function ProjectSelector() {
  const { projects, selectedProjectId, setSelectedProject } = useAppStore();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">项目列表</h3>
        <span className="text-xs text-gray-500">{projects.length} 个项目</span>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {projects.map((project) => (
          <ProjectOption
            key={project.id}
            project={project}
            isSelected={project.id === selectedProjectId}
            onClick={() => setSelectedProject(project.id)}
          />
        ))}
      </div>
    </div>
  );
}
