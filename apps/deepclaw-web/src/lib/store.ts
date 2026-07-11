import { create } from 'zustand';
import type { Project, AgentEmployee, AgentStatus, AgentProjectStats, Task, ChatMessage } from '@deepclaw/core';
import { getProjectStatus } from '@deepclaw/core';

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
  browserId: string;
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project[];
  messages: {[key: string]: ChatMessage[]},
  busyChatKeys: Record<string, boolean>;
  selectedAgentId: string | null;
  initializedChat: Record<string, boolean>;

  // Actions
  getAgents: () => AgentEmployee[];
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => void;
  getProjects: () => Project[];
  setProjects: (projects: Project[]) => void;
  updateProject: (project: Partial<Project> & { id: string }) => void;
  updateProjectTask: (projectId: string, taskTitle: string, task: Partial<Task>) => void;
  addPulledMessages: (loopId: string, messages: ChatMessage[], head?: boolean) => void;
  addMessage: (loopId: string, message: ChatMessage) => void;
  getMessageById: (loopId: string, id: string) => ChatMessage | undefined;
  getOldestMessageId: (loopId: string) => string | undefined;
  getNewestMessageId: (loopId: string) => string | undefined;
  updateMessage: (loopId: string, id: string, text: string) => void;
  setChatBusy: (loopId: string, busy: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  browserId: crypto.randomUUID(),
  agents: [],
  activeAgents: [],
  projects: [],
  messages: {},
  busyChatKeys: {},
  selectedAgentId: null,
  initializedChat: {},

  getAgents: () => get().agents,
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
  getProjects: () => get().projects,
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
  addPulledMessages: (loopId: string, messages: ChatMessage[], head: boolean = false) => set((state) => {
    const oldMessages = state.messages[loopId] || [];
    return {
      messages: {...state.messages, ...{[loopId]: head ? [...messages, ...oldMessages] : [...oldMessages, ...messages]}}
    };
  }),
  addMessage: (loopId: string, message: ChatMessage) => set((state) => {
    const oldMessages = state.messages[loopId] || [];
    return {
      messages: {...state.messages, ...{[loopId]: [...oldMessages, message]}}
    };
  }),
  getOldestMessageId: (loopId: string) =>  {
    return get().messages[loopId]?.[0]?.id;
  },
  getNewestMessageId: (loopId: string) =>  {
    const messages = get().messages[loopId];
    return messages?.[messages.length - 1]?.id;
  },
  getMessageById: (loopId: string, id: string) => {
    return get().messages[loopId]?.findLast(m => m.id === id);
  },
  updateMessage: (loopId: string, id: string, text: string) => set((state) => {
    const message = state.getMessageById(loopId, id);
    if (!message) {
        // PASS
        return {};
    } else {
        return {
            messages: {
              ...state.messages,
              ...{[loopId]: state.messages[loopId].map(m => m.id === message.id ? { ...m, content: m.content + text } : m)}
            }
        };
    }
  }),
  setChatBusy: (loopId: string, busy: boolean) => set((state) => ({
    busyChatKeys: {
      ...state.busyChatKeys,
      [loopId]: busy,
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
