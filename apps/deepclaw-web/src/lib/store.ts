import { create } from 'zustand';
import type { Project, AgentEmployee, AgentStatus, AgentProjectStats } from '@deepclaw/core';
import { getFlushAgentKey, getProjectStatus } from '@deepclaw/core';
import type { Message } from '@/component-types';

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
  messages: {[key: string]: Message[]},
  selectedAgentId: string | null;

  // Actions
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (id: string, employee: Partial<AgentEmployee>) => void;
  setProjects: (projects: Project[]) => void;
  updateProject: (project: Project) => void;
  addMessage: (type: 'user' | 'agent', agentId: string, projectId: string, content: string) => void;
  updateMessageStream: (agentId: string, projectId: string, text: string) => void;
  setSelectedAgent: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  agents: [],
  activeAgents: [],
  projects: [],
  messages: {},
  selectedAgentId: null,

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
  updateProject: (project: Project): void => {
    set((state) => {
      const exists = state.projects.some(p => p.id === project.id);
      return {
        projects: exists
          ? state.projects.map(p => p.id === project.id ? project : p)
          : [...state.projects, project],
      };
    });
  },

  addMessage: (type: 'user' | 'agent', agentId: string, projectId: string, content: string) => set((state) => {
    const chatKey = getChatKey(agentId, projectId);
    const oldMessages = state.messages[getChatKey(agentId, projectId)] || [];
    return {
      messages: {...state.messages, ...{[chatKey]: [...oldMessages, newMessage(
        type, agentId, content
      )]}}
    };
  }),
  updateMessageStream: (agentId: string, projectId: string, text: string) => set((state) => {
    const chatKey = getChatKey(agentId, projectId);
    const message = state.messages[chatKey]?.findLast(m => m.type === 'agent');
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
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
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

export function getChatKey(agentId: string, projectId: string): string {
    return getFlushAgentKey(agentId, projectId);
}
