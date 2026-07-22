'use server';

import { SSEServer } from '@/app/api/sse-server';
import { ChatMessage, FlushAgentRole, TokenUsage } from '@deepclaw/core';
import { LoopGateway, UIChatService } from '@deepclaw/loop-gateway';

export async function invoke(
    browserId: string, role: FlushAgentRole, agentId: string, projectId: string, input: string
): Promise<{busy: boolean, msgId: string}> {
    return LoopGateway.invoke(browserId, role, agentId, projectId, input);
}

export async function resumeLoop(browserId: string, loopId: string): Promise<{resume: boolean, msgId: string}> {
    SSEServer.activeClient(browserId, loopId, true);
    return LoopGateway.resume(browserId, loopId);
}

export async function getTokenUsage(loopId: string): Promise<TokenUsage | undefined> {
    return LoopGateway.getTokenUsage(loopId);
}

export async function inactiveLoop(browserId: string, loopId: string): Promise<void> {
    SSEServer.activeClient(browserId, loopId, false);
}

export async function resolveInteraction(browserId: string, loopId: string, answer: string): Promise<boolean> {
    return LoopGateway.resolveInteraction(browserId, loopId, answer);
}

export async function pullOlderMessages(loopId: string, endMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getOlderMessages(loopId, endMessageId);
}

export async function pullNewerMessages(loopId: string, startMessageId?: string): Promise<ChatMessage[]> {
    return UIChatService.getNewerMessages(loopId, startMessageId);
}

export async function pushChatMessage(browserId: string, loopId: string, message: ChatMessage): Promise<void> {
    LoopGateway.addMessage(browserId, loopId, message);
}

export async function updateChatMessage(browserId: string, loopId: string, id: string, text: string): Promise<void> {
    LoopGateway.updateMessage(browserId, loopId, id, text);
}
