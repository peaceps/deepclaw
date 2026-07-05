'use server';

import { ChatMessage } from '@deepclaw/core';
import { LoopGateway, UIChatService } from '@deepclaw/loop-gateway';

export async function invoke(agentId: string, projectId: string, clientId: string, input: string): Promise<void> {
    return LoopGateway.invoke(agentId, projectId, clientId, input);
}

export async function resolveInteraction(loopId: string, clientId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(loopId, clientId, answer);
}

export async function pullChatMessages(loopId: string, lastMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getMessages(loopId, lastMessageId);
}

export async function pushChatMessage(loopId: string, clientId: string, message: ChatMessage): Promise<void> {
    UIChatService.addMessage(loopId, message);
    LoopGateway.fireChatMessageEvent(loopId, clientId, message);
}
