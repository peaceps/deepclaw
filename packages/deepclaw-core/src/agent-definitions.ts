export type AgentSoulIdentity = {
  id: string;
  avatar: string;
  role: string;
  personalities: string[];
  emotion: boolean;
  expertises: string[];
}

export type AgentIdentity = AgentSoulIdentity & {
  name: string;
  fired: boolean;
  description: string;
}

export type AgentStatus = 'busy' | 'idle' | 'fired';

export type AgentProjectStats = {
  todo: number;
  ongoing: number;
  done: number;
}

export type AgentMood = {
  mood: 'happy' | 'focused' | 'tired' | 'confused' | 'none';
}

export type AgentEmployee = AgentIdentity & AgentMood;

export type TokenUsage = {
    cachedInputTokens: number;
    noCachedInputTokens: number;
    outputTokens: number;
}

export function addTokenUsage(usage: TokenUsage, added: TokenUsage): void {
    usage.cachedInputTokens += added.cachedInputTokens;
    usage.noCachedInputTokens += added.noCachedInputTokens;
    usage.outputTokens += added.outputTokens;
}

export type ChatMessage = {
    id: string;
    agentId: string;
    content: string;
    type: 'user' | 'agent';
    timestamp: string;
}

export function newMessage(type: 'user' | 'agent', agentId: string, content: string): ChatMessage {
    return {
        id: crypto.randomUUID(),
        agentId,
        content,
        type,
        timestamp: new Date().toISOString(),
    };
}
