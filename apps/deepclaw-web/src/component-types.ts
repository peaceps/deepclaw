export type Message = {
    id: string;
    agentId: string;
    content: string;
    type: 'user' | 'agent' | 'thought';
    timestamp: string;
}

export type MobileView = 'list' | 'detail' | 'chat';
