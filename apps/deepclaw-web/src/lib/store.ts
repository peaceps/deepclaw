import { create } from 'zustand';
import type {
  Project, AgentEmployee, AgentStatus, AgentProjectStats, RunningTask, Task, ChatMessage
} from '@deepclaw/core';
import { getProjectStatus, splitLoopId } from '@deepclaw/core';
import { UpdateContent } from '@deepclaw/utils';
import { handleUpdatedArrayContent, handleUpdateRecordContent } from '@/components/component-utils';

export type AgentSummary = {
  status: AgentStatus;
  stats: AgentProjectStats;
};

/** What an agent is doing at this very moment, as opposed to what it was given to do. */
export type AgentActivity = {
  runningTasks: RunningTask[];
  busyLoops: string[];
};

/** Reads the two live signals off the store, they always travel together. */
export function useAgentActivity(): AgentActivity {
  const runningTasks = useAppStore(s => s.runningTasks);
  const busyLoops = useAppStore(s => s.busyLoops);
  return { runningTasks, busyLoops };
}

/**
 * Busy means this agent is at work right now, either in a loop of its own or through a subagent
 * running one of its tasks. An open project says the work was planned, not that anyone is on it,
 * so the counts and the status answer two different questions.
 */
export function deriveAgentSummary(
  agent: AgentEmployee | undefined, projects: Project[], activity: AgentActivity
): AgentSummary {
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
  return { status: isAtWork(agent.id, activity) ? 'busy' : 'idle', stats };
}

function isAtWork(agentId: string, {runningTasks, busyLoops}: AgentActivity): boolean {
  return runningTasks.some(run => run.agentId === agentId)
    || busyLoops.some(loopId => splitLoopId(loopId).agentId === agentId);
}

type AppState = {
  browserId: string;
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project[];
  runningTasks: RunningTask[];
  busyLoops: string[];
  messages: {[key: string]: ChatMessage[]},
  busyChatKeys: Record<string, boolean>;
  selectedAgentId: string | null;
  initializedChat: Record<string, boolean>;

  // Actions
  getAgents: () => AgentEmployee[];
  getAgentById: (id: string) => AgentEmployee | undefined;
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (employee: UpdateContent<AgentEmployee>) => void;
  getProjects: () => Project[];
  setProjects: (projects: Project[]) => void;
  updateProject: (project: UpdateContent<Project>) => void;
  updateProjectTask: (projectId: string, task: UpdateContent<Task, 'title'>) => void;
  setRunningTasks: (runningTasks: RunningTask[]) => void;
  setBusyLoops: (busyLoops: string[]) => void;
  addPulledMessages: (loopId: string, messages: ChatMessage[], head?: boolean) => void;
  addMessage: (loopId: string, message: ChatMessage) => void;
  getMessageById: (loopId: string, id: string) => ChatMessage | undefined;
  getOldestMessageId: (loopId: string) => string | undefined;
  getNewestMessageId: (loopId: string) => string | undefined;
  updateMessage: (loopId: string, id: string, text: string) => void;
  replaceMessage: (loopId: string, id: string, text: string) => void;
  setChatBusy: (loopId: string, busy: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  browserId: crypto.randomUUID(),
  agents: [],
  activeAgents: [],
  projects: [],
  runningTasks: [],
  busyLoops: [],
  messages: {},
  busyChatKeys: {},
  selectedAgentId: null,
  initializedChat: {},

  getAgents: () => get().agents,
  getAgentById: (id: string) => get().agents.find(a => a.id === id),
  setAgents: (agents) => {
    set({ agents, activeAgents: agents.filter(a => !a.fired) });
    reselectAgent(get, set);
  },
  updateAgentEmployee: (employee: UpdateContent<AgentEmployee>) => {
    set((state) => {
        const agents = handleUpdatedArrayContent(state.agents, employee);
        const activeAgents = agents.filter(a => !a.fired);
        return { agents, activeAgents };
    });
    selectFirstActiveAgent(get, set);
  },
  getProjects: () => get().projects,
  setProjects: (projects) => set({ projects }),
  updateProject: (project: UpdateContent<Project>): void => {
    set((state) => ({ projects: handleUpdatedArrayContent(state.projects, project) }));
  },
  updateProjectTask: (projectId: string, data: UpdateContent<Task, 'title'>): void => {
    set((state) => {
      const project = state.projects.find(p => p.id === projectId);
      if (!project) {
        throw new Error('Project not found.');
      }
      const taskTitle = data.title;
      const task = project.tasks[taskTitle];
      if (!task) {
        throw new Error('Task not found.');
      }
      return { projects: state.projects.map(p => p.id === projectId ? {
        ...project,
        tasks: handleUpdateRecordContent(project.tasks, { ...data, title: taskTitle }, false, 'title'),
      } : p) };
    });
  },
  setRunningTasks: (runningTasks) => set({ runningTasks }),
  setBusyLoops: (busyLoops) => set({ busyLoops }),
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
  replaceMessage: (loopId: string, id: string, text: string) => set((state) => {
    const message = state.getMessageById(loopId, id);
    if (!message) {
        return {};
    }
    return { messages: { ...state.messages, ...{[loopId]: state.messages[loopId].map(m => m.id === id ? { ...m, content: text } : m) } } };
  }),
  setChatBusy: (loopId: string, busy: boolean) => set((state) => ({
    busyChatKeys: {
      ...state.busyChatKeys,
      [loopId]: busy,
    },
  })),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
}));

/** A roster that arrives whole may no longer hold the agent the page was showing. */
function reselectAgent(get: () => AppState, set: (state: Partial<AppState>) => void): void {
    const { selectedAgentId, activeAgents } = get();
    if (selectedAgentId && !activeAgents.some(a => a.id === selectedAgentId)) {
        set({ selectedAgentId: null });
    }
    selectFirstActiveAgent(get, set);
}

/**
 * A page with nothing selected has nothing to show, so the first agent to arrive takes the place:
 * on a fresh install that is the one the config the user just filled in has hired.
 */
function selectFirstActiveAgent(get: () => AppState, set: (state: Partial<AppState>) => void): void {
    const { selectedAgentId, activeAgents } = get();
    if (!selectedAgentId && activeAgents.length > 0) {
        set({ selectedAgentId: activeAgents[0].id });
    }
}
