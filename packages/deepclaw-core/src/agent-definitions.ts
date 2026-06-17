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

export type AgentStatus = {
  status: 'busy' | 'idle' | 'fired';
  mood: 'happy' | 'focused' | 'tired' | 'confused' | 'none';
  stats: {
    tasksCompleted: number;
  };
}

export type AgentEmployee = AgentIdentity & AgentStatus;
