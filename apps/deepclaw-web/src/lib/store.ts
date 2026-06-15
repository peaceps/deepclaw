import { create } from 'zustand';
import { Task, Project } from '@deepclaw/loop-gateway';
import { AgentEmployee } from "@deepclaw/core";
import { Message } from '@/components/chat/message-type';

type AppState = {
  agents: AgentEmployee[];
  projects: Project<Task>[];
  messages: Message[];
  selectedAgentId: string | null;

  // Actions
  setSelectedAgent: (id: string | null) => void;
  addMessage: (message: Message) => void;
}

export const useAppStore = create<AppState>((set) => ({
  agents: [],
  projects: [],
  messages: [],
  selectedAgentId: null, // 默认选中第一个员工

  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
}));
