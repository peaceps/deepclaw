import { create } from 'zustand';
import type { AgentInteractionEventPayload } from '@deepclaw/core';

type InteractionModalState = {
  visible: boolean;
  event: AgentInteractionEventPayload | null;
  loopId: string | null;
  instanceId: number;
  resolve: ((answer: string | null) => void) | null;

  showModal: (loopId: string, event: AgentInteractionEventPayload) => Promise<string | null>;
  closeModal: (answer: string | null) => void;
};

export const useInteractionModalStore = create<InteractionModalState>((set, get) => ({
  visible: false,
  event: null,
  loopId: null,
  instanceId: 0,
  resolve: null,

  showModal: (loopId: string, event: AgentInteractionEventPayload) => {
    return new Promise<string | null>((resolve) => {
      set((state) => ({
        visible: true,
        loopId,
        event,
        instanceId: state.instanceId + 1,
        resolve,
      }));
    });
  },

  closeModal: (answer: string | null) => {
    const { resolve } = get();
    resolve?.(answer);
    set({ visible: false, event: null, loopId: null, resolve: null });
  },
}));
