import { create } from 'zustand';
import { Task, Project } from '@deepclaw/loop-gateway';
import { AgentEmployee } from "@deepclaw/core";
import { Message } from '@/components/chat/message-type';
import { getProjectStatus } from '@/components/component-utils';

type AppState = {
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project<Task>[];
  messages: Message[];
  selectedAgentId: string | null;

  // Actions
  setAgents: (agents: AgentEmployee[]) => void;
  setProjects: (projects: Project<Task>[]) => void;
  setMessages: (messages: Message[]) => void;
  setSelectedAgent: (id: string | null) => void;
  addMessage: (message: Message) => void;
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
  setProjects: (projects) => set({ projects }),
  setMessages: (messages) => set({ messages }),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

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

function selectFirstActiveAgent(get: () => AppState, set: (state: Partial<AppState>) => void): void {
    const { selectedAgentId, activeAgents } = get();
    const selectedLost = !activeAgents.some(a => a.id === selectedAgentId);
    if ((!selectedAgentId || selectedLost) && activeAgents.length > 0) {
        set({ selectedAgentId: activeAgents[0].id });
    } else if (selectedLost) {
        set({ selectedAgentId: null });
    }
}
