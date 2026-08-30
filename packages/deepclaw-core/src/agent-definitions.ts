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
  todo: string[];
  ongoing: string[];
  done: string[];
}

export const AGENT_CONFIG = {
  /** Read by the tool schema, by the words that ask for a feeling, and by the cut that holds it. */
  maxEmotionLength: 30,
} as const;

export type AgentRuntimeStatus = {
  mood: 'happy' | 'focused' | 'tired' | 'confused' | 'none';
  emotions?: string[];
}

export type AgentEmployee = AgentIdentity & AgentRuntimeStatus;

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

export type ImageContent = {
    url: string;
    mediaType?: string;
}

export type ChatMessage = {
    id: string;
    agentId: string;
    content: string;
    images?: ImageContent[];
    type: 'user' | 'agent';
    timestamp: string;
}

export function newMessage(
    type: 'user' | 'agent', agentId: string, content: string, images?: ImageContent[]
): ChatMessage {
    return {
        id: crypto.randomUUID(),
        agentId,
        content,
        images,
        type,
        timestamp: new Date().toISOString(),
    };
}
