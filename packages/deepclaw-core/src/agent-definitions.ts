export type AgentSoulIdentity = {
  id: string;
  avatar: string;
  role: string;
  personalities: string[];
  emotion: boolean;
  expertises: string[];
  /**
   * How many of this agent's projects were finished and then put away, counted here because
   * nothing else outlives them: an archived project leaves the board and the manager with its
   * folder, and the work it stands for would leave the agent's tally at the same moment.
   *
   * Finished when it was put away, and not merely put away: this number stands in the done column
   * beside the projects still on the board, and one the user gave up on and cleared away was never
   * done. Absent in a soul file written before there was anything to count, which reads as none.
   */
  archivedDoneProjects?: number;
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
  /**
   * The finished ones already put away, which are a number and not a list: their titles went with
   * the folder, and what is left of them is that they happened.
   */
  archivedDone: number;
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
