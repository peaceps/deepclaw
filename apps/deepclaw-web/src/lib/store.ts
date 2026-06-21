import { create } from 'zustand';
import type { Task, Project } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from "@deepclaw/core";
import type { Message } from '@/component-types';
import { getProjectStatus } from '@/components/component-utils';

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
  updateMessageStream: (chatKey: string, text: string) => void;
  getChatMessages: (agentId: string, projectId: string) => Message[] | undefined;
  setSelectedAgent: (id: string | null) => void;
  getSelectedAgent: () => AgentEmployee | undefined;
  getOneOngoingProject: (agentId: string) => Project | undefined;
  getProjectOwner: (projectId: string) => AgentEmployee | undefined;
  getTaskAssignee: (task: Task) => AgentEmployee | undefined;
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
  updateMessageStream: (chatKey: string, text: string) => set((state) => {
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
  getChatMessages: (agentId: string, projectId: string): Message[] | undefined =>  {
    return get().messages[getChatKey(agentId, projectId)];
  },

  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  getSelectedAgent(): AgentEmployee | undefined {
    return get().agents.find(a => a.id === get().selectedAgentId);
  },
  getOneOngoingProject(agentId: string): Project | undefined {
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

function getChatKey(agentId: string, projectId: string): string {
  return `${agentId}.${projectId}`;
}
