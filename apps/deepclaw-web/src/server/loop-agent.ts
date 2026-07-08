'use server';

import { ChatMessage } from '@deepclaw/core';
import { LoopGateway, UIChatService } from '@deepclaw/loop-gateway';

export async function invoke(agentId: string, projectId: string, clientId: string, input: string): Promise<void> {
    return LoopGateway.invoke(agentId, projectId, clientId, input);
}

export async function resolveInteraction(loopId: string, clientId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(loopId, clientId, answer);
}

export async function pullOlderMessages(loopId: string, endMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getOlderMessages(loopId, endMessageId);
}

export async function pullNewerMessages(loopId: string, startMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getNewerMessages(loopId, startMessageId);
}

export async function pushChatMessage(loopId: string, clientId: string, message: ChatMessage): Promise<void> {
    LoopGateway.addMessage(loopId, clientId, message);
}

export async function updateChatMessage(loopId: string, clientId: string, id: string, text: string): Promise<void> {
    LoopGateway.updateMessage(loopId, clientId, id, text);
}
