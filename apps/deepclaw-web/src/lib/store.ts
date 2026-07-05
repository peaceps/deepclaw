import { create } from 'zustand';
import type { Project, AgentEmployee, AgentStatus, AgentProjectStats, Task, ChatMessage } from '@deepclaw/core';
import { getFlushAgentKey, getProjectStatus } from '@deepclaw/core';

export type AgentSummary = {
  status: AgentStatus;
  stats: AgentProjectStats;
};

export function deriveAgentSummary(agent: AgentEmployee | undefined, projects: Project[]): AgentSummary {
  const stats: AgentProjectStats = { todo: 0, ongoing: 0, done: 0 };
  if (!agent) {
    return { status: 'fired', stats };
  }
  for (const project of projects) {
    if (project.creator === agent.id) {
      stats[getProjectStatus(project)]++;
    }
  }
  if (agent.fired) {
    return { status: 'fired', stats };
  }
  const status: AgentStatus = (stats.ongoing > 0 || stats.todo > 0) ? 'busy' : 'idle';
  return { status, stats };
}

type AppState = {
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project[];
  messages: {[key: string]: ChatMessage[]},
  busyChatKeys: Record<string, boolean>;
  selectedAgentId: string | null;

  // Actions
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => void;
  setProjects: (projects: Project[]) => void;
  updateProject: (project: Partial<Project> & { id: string }) => void;
  updateProjectTask: (projectId: string, taskTitle: string, task: Partial<Task>) => void;
  addPulledMessages: (chatKey: string, messages: ChatMessage[]) => void;
  addMessage: (chatKey: string, message: ChatMessage) => void;
  getMessageById: (chatKey: string, id: string) => ChatMessage | undefined;
  getOldestMessageId: (chatKey: string) => string | undefined;
  updateMessageStream: (chatKey: string, id: string, text: string) => void;
  setChatBusy: (chatKey: string, busy: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  agents: [],
  activeAgents: [],
  projects: [],
  messages: {},
  busyChatKeys: {},
  selectedAgentId: null,

  setAgents: (agents) => {
    set({ agents, activeAgents: agents.filter(a => !a.fired) });
    selectFirstActiveAgent(get, set);
  },
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => {
    set((state) => {
        const exists = state.agents.some(a => a.id === id);
        const agents = exists ? state.agents.map(a => a.id === id ? { ...a, ...employee } : a)
          : [...state.agents, { id, ...employee } as AgentEmployee];
        const activeAgents = agents.filter(a => !a.fired);
        return { agents, activeAgents };
    });
  },
  setProjects: (projects) => set({ projects }),
  updateProject: (project: Partial<Project> & { id: string }): void => {
    set((state) => {
      const exists = state.projects.some(p => p.id === project.id);
      return {
        projects: exists
          ? state.projects.map(p => p.id === project.id ? { ...p, ...project } : p)
          : [...state.projects, project as Project],
      };
    });
  },
  updateProjectTask: (projectId: string, taskTitle: string, data: Partial<Task>): void => {
    set((state) => {
      const project = state.projects.find(p => p.id === projectId);
      if (!project) {
        throw new Error('Project not found.');
      }
      const task = project.tasks[taskTitle];
      if (!task) {
        throw new Error('Task not found.');
      }
      return { projects: state.projects.map(p => p.id === projectId ? {
        ...project,
        tasks: {...project.tasks, [taskTitle]: { ...task, ...data }},
      } : p) };
    });
  },
  addPulledMessages: (chatKey: string, messages: ChatMessage[]) => set((state) => {
    const oldMessages = state.messages[chatKey] || [];
    return {
      messages: {...state.messages, ...{[chatKey]: [...messages, ...oldMessages]}}
    };
  }),
  addMessage: (chatKey: string, message: ChatMessage) => set((state) => {
    const oldMessages = state.messages[chatKey] || [];
    return {
      messages: {...state.messages, ...{[chatKey]: [...oldMessages, message]}}
    };
  }),
  getOldestMessageId: (chatKey: string) =>  {
    return get().messages[chatKey]?.[0].id;
  },
  getMessageById: (chatKey: string, id: string) => {
    return get().messages[chatKey]?.findLast(m => m.id === id);
  },
  updateMessageStream: (chatKey: string, id: string, text: string) => set((state) => {
    const message = state.getMessageById(chatKey, id);
    if (!message) {
        // PASS
        return {};
    } else {
        return {
            messages: {
              ...state.messages,
              ...{[chatKey]: state.messages[chatKey].map(m => m.id === message.id ? { ...m, content: m.content + text } : m)}
            }
        };
    }
  }),
  setChatBusy: (chatKey: string, busy: boolean) => set((state) => ({
    busyChatKeys: {
      ...state.busyChatKeys,
      [chatKey]: busy,
    },
  })),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
}));

function selectFirstActiveAgent(get: () => AppState, set: (state: Partial<AppState>) => void): void {
    const { selectedAgentId, activeAgents } = get();
    const selectedLost = !activeAgents.some(a => a.id === selectedAgentId);
    if ((!selectedAgentId || selectedLost) && activeAgents.length > 0) {
        set({ selectedAgentId: activeAgents[0].id });
    } else if (selectedLost) {
        set({ selectedAgentId: null });
    }
}

export function getChatKey(agentId: string, projectId: string): string {
    return getFlushAgentKey(agentId, projectId);
}
