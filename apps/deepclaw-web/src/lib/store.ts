import { create } from 'zustand';
import type {
  Project, AgentEmployee, AgentStatus, AgentProjectStats, CronTask, RunningTask, Task, ChatMessage
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
  const stats: AgentProjectStats = { todo: [], ongoing: [], done: [] };
  if (!agent) {
    return { status: 'fired', stats };
  }
  for (const project of projects) {
    if (project.creator === agent.id) {
      stats[getProjectStatus(project)].push(project.title);
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

const browserIdKey = 'browser.id';

/**
 * The name the server knows this tab by. It lives in the session so that a reload comes back as the
 * same browser and is handed the question it left unanswered, while another tab is another browser
 * with a chat of its own. A server render has no session, and its id is thrown away with the render.
 */
export function sessionBrowserId(): string {
  try {
    const stored = window.sessionStorage.getItem(browserIdKey);
    if (stored) {
      return stored;
    }
    const browserId = crypto.randomUUID();
    window.sessionStorage.setItem(browserIdKey, browserId);
    return browserId;
  } catch {
    return crypto.randomUUID();
  }
}

type AppState = {
  browserId: string;
  agents: AgentEmployee[];
  activeAgents: AgentEmployee[];
  projects: Project[];
  runningTasks: RunningTask[];
  busyLoops: string[];
  cronTasks: CronTask[];
  messages: {[key: string]: ChatMessage[]},
  busyChatKeys: Record<string, boolean>;
  selectedAgentId: string | null;
  /**
   * The chat a click from outside the page asked to be taken to. A wide layout has the chat beside
   * the agent or inside the project row, so naming the loop is all it takes; a layout that shows one
   * thing at a time, or a row the user folded away, has to be told to make room for it. The count is
   * what asking twice for the same chat is told apart by, since a page answers each call once.
   */
  openChatCall: {loopId: string; seq: number} | null;
  initializedChat: Record<string, boolean>;
  /**
   * Transient emotion bubble anchored to an agent card; a bump of seq re-arms its timer, and at
   * tells a card that mounts later how old the emotion is, so it does not pop a stale one.
   */
  emotionPopup: Record<string, { text: string; seq: number; at: number }>;

  // Actions
  getAgents: () => AgentEmployee[];
  getAgentById: (id: string) => AgentEmployee | undefined;
  setAgents: (agents: AgentEmployee[]) => void;
  updateAgentEmployee: (employee: UpdateContent<AgentEmployee>) => void;
  showEmotionPopup: (agentId: string, text: string) => void;
  dismissEmotionPopup: (agentId: string) => void;
  getProjects: () => Project[];
  setProjects: (projects: Project[]) => void;
  updateProject: (project: UpdateContent<Project>) => void;
  updateProjectTask: (projectId: string, task: UpdateContent<Task>) => void;
  setRunningTasks: (runningTasks: RunningTask[]) => void;
  setBusyLoops: (busyLoops: string[]) => void;
  setCronTasks: (cronTasks: CronTask[]) => void;
  updateCronTask: (cronTask: UpdateContent<CronTask>) => void;
  addPulledMessages: (loopId: string, messages: ChatMessage[], head?: boolean) => void;
  addMessage: (loopId: string, message: ChatMessage) => void;
  getMessageById: (loopId: string, id: string) => ChatMessage | undefined;
  getOldestMessageId: (loopId: string) => string | undefined;
  getNewestMessageId: (loopId: string) => string | undefined;
  updateMessage: (loopId: string, id: string, text: string) => void;
  replaceMessage: (loopId: string, id: string, text: string) => void;
  clearMessages: (chatKey: string) => void;
  setChatBusy: (loopId: string, busy: boolean) => void;
  setSelectedAgent: (id: string | null) => void;
  openChat: (loopId: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  browserId: sessionBrowserId(),
  agents: [],
  activeAgents: [],
  projects: [],
  runningTasks: [],
  busyLoops: [],
  cronTasks: [],
  messages: {},
  busyChatKeys: {},
  selectedAgentId: null,
  openChatCall: null,
  initializedChat: {},
  emotionPopup: {},

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
  showEmotionPopup: (agentId, text) => set((state) => ({
    emotionPopup: {
      ...state.emotionPopup,
      [agentId]: { text, seq: (state.emotionPopup[agentId]?.seq ?? 0) + 1, at: Date.now() },
    },
  })),
  dismissEmotionPopup: (agentId) => set((state) => {
    if (!state.emotionPopup[agentId]) {
      return {};
    }
    const emotionPopup = { ...state.emotionPopup };
    delete emotionPopup[agentId];
    return { emotionPopup };
  }),
  getProjects: () => get().projects,
  setProjects: (projects) => set({ projects }),
  updateProject: (project: UpdateContent<Project>): void => {
    set((state) => ({ projects: handleUpdatedArrayContent(state.projects, project) }));
  },
  updateProjectTask: (projectId: string, data: UpdateContent<Task>): void => {
    set((state) => {
      const project = state.projects.find(p => p.id === projectId);
      if (!project) {
        throw new Error('Project not found.');
      }
      if (!project.tasks[data.id]) {
        throw new Error('Task not found.');
      }
      return { projects: state.projects.map(p => p.id === projectId ? {
        ...project,
        tasks: handleUpdateRecordContent(project.tasks, data),
      } : p) };
    });
  },
  setRunningTasks: (runningTasks) => set({ runningTasks }),
  setBusyLoops: (busyLoops) => set({ busyLoops }),
  setCronTasks: (cronTasks) => set({ cronTasks }),
  /** A closed task is gone for good, the service drops it from the list it hands out. */
  updateCronTask: (cronTask: UpdateContent<CronTask>): void => {
    set((state) => ({
      cronTasks: handleUpdatedArrayContent(state.cronTasks, cronTask, !!cronTask.closed),
    }));
  },
  /**
   * A message that comes back is the message as it stands now: one this tab watched being written
   * and left half way through is replaced by the whole of it, rather than joining it as a second.
   */
  addPulledMessages: (loopId: string, messages: ChatMessage[], head: boolean = false) => set((state) => {
    const oldMessages = state.messages[loopId] || [];
    const pulled = new Map(messages.map(message => [message.id, message]));
    const held = oldMessages.map(message => pulled.get(message.id) ?? message);
    const heldIds = new Set(oldMessages.map(message => message.id));
    const added = messages.filter(message => !heldIds.has(message.id));
    return {
      messages: {...state.messages, ...{[loopId]: head ? [...added, ...held] : [...held, ...added]}}
    };
  }),
  /**
   * A message is what its id says it is. Two chats of one loop can be on the page at once, a wide
   * layout and a narrow one both being there to be shown, and each of them hears the loop say the
   * same message arrived: told twice, it is still the one message, and holding it twice would grow
   * both copies with every chunk that follows.
   */
  addMessage: (loopId: string, message: ChatMessage) => set((state) => {
    const oldMessages = state.messages[loopId] || [];
    if (oldMessages.some(held => held.id === message.id)) {
      return {};
    }
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
  /**
   * Drops a transcript whole, named by the chat it was held under. A conversation that was closed
   * is dropped because adding to a transcript that is no longer the one being written would make a
   * record of two conversations read as one; one that was read back is dropped because the reading
   * is over, and a tab that kept every conversation its user ever opened would only grow.
   */
  clearMessages: (chatKey: string) => set((state) => {
    const {[chatKey]: dropped, ...rest} = state.messages;
    return !dropped ? {} : {messages: rest};
  }),
  setChatBusy: (loopId: string, busy: boolean) => set((state) => ({
    busyChatKeys: {
      ...state.busyChatKeys,
      [loopId]: busy,
    },
  })),
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  /**
   * The chat of an agent is shown beside the agent the page has selected, so being called to one is
   * also selecting it. A project chat hangs off the project row instead, and the agent behind it is
   * the one the project names.
   */
  openChat: (loopId: string) => set((state) => {
    const { agentId, projectId } = splitLoopId(loopId);
    const openChatCall = { loopId, seq: (state.openChatCall?.seq ?? 0) + 1 };
    return projectId ? { openChatCall } : { openChatCall, selectedAgentId: agentId };
  }),
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
