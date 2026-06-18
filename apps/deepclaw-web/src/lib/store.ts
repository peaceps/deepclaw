import { create } from 'zustand';
import type { Task, Project } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from "@deepclaw/core";
import type { Message } from '@/component-types';
import { getProjectStatus } from '@/components/component-utils';

type AppState = {
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project<Task>[];
  messages: Message[];
  selectedAgentId: string | null;

  // Actions
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => void;
  setProjects: (projects: Project<Task>[]) => void;
  updateProject: (project: Project<Task>) => void;
  addMessage: (type: 'user' | 'agent', agentId: string, text: string) => void;
  updateMessageStream: (agentId: string, text: string) => void;
  setSelectedAgent: (id: string | null) => void;
  getSelectedAgent: () => AgentEmployee | undefined;
  getOneOngoingProject: (agentId: string) => Project<Task> | undefined;
  getProjectOwner: (projectId: string) => AgentEmployee | undefined;
  getTaskAssignee: (task: Task) => AgentEmployee | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  agents: [],
  activeAgents: [],
  projects: [],
  messages: [],
  selectedAgentId: null, // 默认选中第一个员工

  setAgents: (agents) => {
    set({ agents, activeAgents: agents.filter(a => !a.fired) });
    selectFirstActiveAgent(get, set);
  },
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => {
    set((state) => {
        const agents = state.agents.map(a => a.id === id ? { ...a, ...employee } : a);
        const activeAgents = agents.filter(a => !a.fired);
        return { agents, activeAgents };
    });
  },
  setProjects: (projects) => set({ projects }),
  updateProject(project: Project<Task>): void {
    set((state) => {
      const exists = state.projects.some(p => p.id === project.id);
      return {
        projects: exists
          ? state.projects.map(p => p.id === project.id ? project : p)
          : [...state.projects, project],
      };
    });
  },

  addMessage: (type: 'user' | 'agent', agentId: string, text: string) => set((state) => ({
    messages: [...state.messages, newMessage(type, agentId, text)],
  })),
  updateMessageStream: (agentId: string, text: string) => set((state) => {
    const message = state.messages.findLast(m => m.agentId === agentId && m.type === 'agent');
    if (!message) {
        return {
            messages: [...state.messages, newMessage('agent', agentId, text)],
        };
    } else {
        return {
            messages: state.messages.map(m => m.id === message.id ? { ...m, content: m.content + text } : m)
        };
    }
  }),

  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  getSelectedAgent(): AgentEmployee | undefined {
    return get().agents.find(a => a.id === get().selectedAgentId);
  },
  getOneOngoingProject(agentId: string): Project<Task> | undefined {
    return get().projects.find(p => p.creator === agentId && getProjectStatus(p) !== 'done');
  },
  getProjectOwner(projectId: string): AgentEmployee | undefined {
    const ownerId = get().projects.find(p => p.id === projectId)?.creator;
    return ownerId ? get().agents.find(a => a.id === ownerId) : undefined;
  },
  getTaskAssignee(task: Task): AgentEmployee | undefined {
    return task?.assignee ? get().agents.find(a => a.id === task.assignee) : undefined;
  }
}));

function newMessage(type: 'user' | 'agent', agentId: string, content: string): Message {
    return {
        id: crypto.randomUUID(),
        agentId,
        content,
        type,
        timestamp: new Date().toISOString(),
    };
}

function selectFirstActiveAgent(get: () => AppState, set: (state: Partial<AppState>) => void): void {
    const { selectedAgentId, activeAgents } = get();
    const selectedLost = !activeAgents.some(a => a.id === selectedAgentId);
    if ((!selectedAgentId || selectedLost) && activeAgents.length > 0) {
        set({ selectedAgentId: activeAgents[0].id });
    } else if (selectedLost) {
        set({ selectedAgentId: null });
    }
}
