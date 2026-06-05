import { create } from 'zustand';
import { Task, Message, Project, AgentEmployee } from '@/types';
import { fakeMessages } from '@/data/fakeData';

interface AppState {
  agents: AgentEmployee[];
  projects: Project<Task>[];
  messages: Message[];
  selectedAgentId: string | null;
  selectedProjectId: string | null;

  // Actions
  setSelectedAgent: (id: string | null) => void;
  setSelectedProject: (id: string | null) => void;
  updateTaskStatus: (tprojectId: string, taskId: string, status: Task['status']) => void;
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
  agents: [],
  projects: [],
  messages: fakeMessages,
  selectedAgentId: null, // 默认选中第一个员工
  selectedProjectId: null, // 默认选中第一个项目

  setSelectedAgent: (id) => set({ selectedAgentId: id }),

  setSelectedProject: (id) => set({ selectedProjectId: id }),

  // 更新任务状态，同时同步更新 agents 的 currentTaskId
  updateTaskStatus: (projectId, taskId, status) => set((state) => {
    // 找到任务和对应的项目
    let targetTask: Task | null = null;
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return state;

      const task = project.tasks[taskId];
      if (task) {
        targetTask = task;
      }

    if (!targetTask) return state;

    const newAssigneeId = targetTask.assignee || '';

    return {
      projects: state.projects.map((p) => ({
        ...p,
        tasks: {...p.tasks, [taskId]: {...p.tasks[taskId], status}},
      })),
      // 同步更新 agents 的 currentTaskId
      agents: state.agents.map((agent) => {
        // 如果任务不再是 in_progress，且 agent 的 currentTaskId 是这个任务，则清空
        // if (agent.currentTaskId === taskId && status !== 'ongoing') {
        //   return { ...agent, currentTaskId: null };
        // }
        // // 如果任务变为 in_progress，更新对应 agent 的 currentTaskId
        // if (status === 'ongoing' && agent.id === newAssigneeId) {
        //   return { ...agent, currentTaskId: taskId };
        // }
        return agent;
      }),
    };
  }),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  getAllTasks: () => {
    const { projects } = get();
    return projects.flatMap(p => Object.values(p.tasks));
  },

  getCurrentProjectTasks: () => {
    const { projects, selectedProjectId } = get();
    const currentProject = projects.find(p => p.id === selectedProjectId);
    return Object.values(currentProject?.tasks || {});
  },

  getAgentById: (id) => get().agents.find(a => a.id === id),

  getTaskAssignee: (assigneeId) => undefined//.get().agents.find(a => a.id === assigneeId),
}));
