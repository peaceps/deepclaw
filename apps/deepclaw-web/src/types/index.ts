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
  currentTaskId: string | null; // 改为 ID 引用
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
  assigneeId: string; // 改为 ID 引用，避免数据副本
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

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string };
  memberIds: string[]; // 改为 ID 数组引用
}
