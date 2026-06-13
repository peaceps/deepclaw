export interface Message {
  id: string;
  agentId: string;
  content: string;
  type: 'user' | 'agent' | 'thought';
  timestamp: string;
}
