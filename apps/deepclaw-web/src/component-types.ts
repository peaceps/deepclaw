export type Message = {
    id: string;
    agentId: string;
    content: string;
    type: 'user' | 'agent';
    timestamp: string;
}

export type MobileView = 'list' | 'detail' | 'chat';
