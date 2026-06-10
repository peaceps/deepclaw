import { AgentIdentity } from '@deepclaw/core';

export type AgentEmployee = AgentIdentity & {
  avatar: string;
  department?: string;
  status: 'busy' | 'idle' | 'offline';
  ownedProjects: string[];
  mood: 'happy' | 'focused' | 'tired' | 'confused';
  stats: {
    tasksCompleted: number;
  };
}
