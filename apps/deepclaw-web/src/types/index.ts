export { type Task, type Project, type AgentEmployee } from '@deepclaw/loop-gateway';

export interface Message {
  id: string;
  agentId: string;
  content: string;
  type: 'user' | 'agent' | 'thought';
  timestamp: string;
}
