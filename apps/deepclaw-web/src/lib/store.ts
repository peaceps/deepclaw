import { create } from 'zustand';
import { AgentEmployee, Task, Message } from '@/types';
import { fakeAgents, fakeTasks, fakeMessages } from '@/data/fakeData';

interface AppState {
  agents: AgentEmployee[];
  tasks: Task[];
  messages: Message[];
  selectedAgentId: string | null;
  
  // Actions
  setSelectedAgent: (id: string | null) => void;
  updateTaskStatus: (taskId: string, status: Task['status']) => void;
  addMessage: (message: Message) => void;
}

export const useAppStore = create<AppState>((set) => ({
  agents: fakeAgents,
  tasks: fakeTasks,
  messages: fakeMessages,
  selectedAgentId: null,
  
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  
  updateTaskStatus: (taskId, status) => set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, status } : t
    ),
  })),
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
}));
