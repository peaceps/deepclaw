import { create } from 'zustand';
import { AgentEmployee, Task, Message, Project } from '@/types';
import { fakeAgents, fakeProjects, fakeMessages, getAgentById, getTaskById } from '@/data/fakeData';

interface AppState {
  agents: AgentEmployee[];
  projects: Project[];
  messages: Message[];
  selectedAgentId: string | null;
  selectedProjectId: string | null;

  // Actions
  setSelectedAgent: (id: string | null) => void;
  setSelectedProject: (id: string | null) => void;
  updateTaskStatus: (taskId: string, status: Task['status']) => void;
  addMessage: (message: Message) => void;
  // 获取所有任务（跨项目）
  getAllTasks: () => Task[];
  // 获取当前选中项目的任务
  getCurrentProjectTasks: () => Task[];
  // 通过 ID 获取 Agent
  getAgentById: (id: string) => AgentEmployee | undefined;
  // 通过 assigneeId 获取任务执行人
  getTaskAssignee: (assigneeId: string) => AgentEmployee | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  agents: fakeAgents,
  projects: fakeProjects,
  messages: fakeMessages,
  selectedAgentId: fakeAgents[0]?.id || null, // 默认选中第一个员工
  selectedProjectId: fakeProjects[0]?.id || null, // 默认选中第一个项目

  setSelectedAgent: (id) => set({ selectedAgentId: id }),

  setSelectedProject: (id) => set({ selectedProjectId: id }),

  // 更新任务状态，同时同步更新 agents 的 currentTaskId
  updateTaskStatus: (taskId, status) => set((state) => {
    // 找到任务和对应的项目
    let targetTask: Task | null = null;

    for (const project of state.projects) {
      const task = project.tasks.find(t => t.id === taskId);
      if (task) {
        targetTask = task;
        break;
      }
    }

    if (!targetTask) return state;

    const newAssigneeId = targetTask.assigneeId;

    return {
      projects: state.projects.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === taskId ? { ...t, status } : t
        ),
      })),
      // 同步更新 agents 的 currentTaskId
      agents: state.agents.map((agent) => {
        // 如果任务不再是 in_progress，且 agent 的 currentTaskId 是这个任务，则清空
        if (agent.currentTaskId === taskId && status !== 'in_progress') {
          return { ...agent, currentTaskId: null };
        }
        // 如果任务变为 in_progress，更新对应 agent 的 currentTaskId
        if (status === 'in_progress' && agent.id === newAssigneeId) {
          return { ...agent, currentTaskId: taskId };
        }
        return agent;
      }),
    };
  }),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  getAllTasks: () => {
    const { projects } = get();
    return projects.flatMap(p => p.tasks);
  },

  getCurrentProjectTasks: () => {
    const { projects, selectedProjectId } = get();
    const currentProject = projects.find(p => p.id === selectedProjectId);
    return currentProject?.tasks || [];
  },

  getAgentById: (id) => get().agents.find(a => a.id === id),

  getTaskAssignee: (assigneeId) => get().agents.find(a => a.id === assigneeId),
}));
