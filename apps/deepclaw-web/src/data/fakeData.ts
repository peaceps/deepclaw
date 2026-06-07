import { Message } from '@/types';

export const fakeMessages: Message[] = [
  {
    id: 'm1',
    agentId: 'main',
    content: '这个登录重构任务，我需要先分析一下现有代码结构。',
    type: 'thought',
    timestamp: '2026-05-21T09:05:00Z',
  },
  {
    id: 'm2',
    agentId: 'main',
    content: '预计需要2天完成，目前已完成65%，还剩测试和文档工作。',
    type: 'agent',
    timestamp: '2026-05-21T09:06:00Z',
  },
  {
    id: 'm3',
    agentId: 'main',
    content: '进度不错，继续保持！',
    type: 'user',
    timestamp: '2026-05-21T09:10:00Z',
  },
];

export const getMessagesByAgentId = (agentId: string) => fakeMessages.filter(m => m.agentId === agentId);
