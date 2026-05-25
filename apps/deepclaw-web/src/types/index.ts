export interface AgentEmployee {
  id: string;
  name: string;
  avatar: string;
  role: string;
  department: string;
  personality: {
    traits: string[];
    communicationStyle: 'formal' | 'casual' | 'friendly';
    emotionExpression: boolean;
  };
  skills: string[];
  expertise: string[];
  status: 'online' | 'busy' | 'idle' | 'offline';
  currentTask: Task | null;
  mood: 'happy' | 'focused' | 'tired' | 'confused';
  stats: {
    tasksCompleted: number;
    avgResponseTime: number;
    satisfaction: number;
  };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee: AgentEmployee;
  creator: { id: string; name: string };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  dueDate?: string;
  estimatedHours: number;
  actualHours: number;
  progress: number;
  tags: string[];
}

export interface Message {
  id: string;
  agentId: string;
  content: string;
  type: 'user' | 'agent' | 'thought';
  timestamp: string;
}
