import { AgentEmployee, Task, Message, Project } from '@/types';

export const fakeAgents: AgentEmployee[] = [
  {
    id: '1',
    name: '小虾',
    avatar: '🦐',
    role: '全栈工程师',
    department: '技术部',
    personality: {
      traits: ['严谨', '高效', '追求完美'],
      communicationStyle: 'casual',
      emotionExpression: true,
    },
    skills: ['React', 'Node.js', 'Python', '数据库设计'],
    expertise: ['Web开发', '系统架构'],
    status: 'busy',
    currentTaskId: 't1',
    mood: 'focused',
    stats: {
      tasksCompleted: 128,
      avgResponseTime: 2.5,
      satisfaction: 4.8,
    },
  },
  {
    id: '2',
    name: '小贝',
    avatar: '🐚',
    role: '数据分析师',
    department: '数据部',
    personality: {
      traits: ['细心', '逻辑强', '耐心'],
      communicationStyle: 'formal',
      emotionExpression: false,
    },
    skills: ['Python', 'SQL', '数据可视化', '机器学习'],
    expertise: ['数据分析', '报表生成'],
    status: 'online',
    currentTaskId: 't2',
    mood: 'happy',
    stats: {
      tasksCompleted: 96,
      avgResponseTime: 3.2,
      satisfaction: 4.9,
    },
  },
  {
    id: '3',
    name: '小文',
    avatar: '📚',
    role: '内容编辑',
    department: '内容部',
    personality: {
      traits: ['创意', '表达力强', '热情'],
      communicationStyle: 'friendly',
      emotionExpression: true,
    },
    skills: ['写作', '编辑', 'SEO', '内容策划'],
    expertise: ['文案撰写', '内容运营'],
    status: 'idle',
    currentTaskId: 't3',
    mood: 'happy',
    stats: {
      tasksCompleted: 156,
      avgResponseTime: 1.8,
      satisfaction: 4.7,
    },
  },
  {
    id: '4',
    name: '小管',
    avatar: '📋',
    role: '项目经理',
    department: '管理部',
    personality: {
      traits: ['组织力强', '善于协调', '果断'],
      communicationStyle: 'formal',
      emotionExpression: false,
    },
    skills: ['项目管理', '团队协作', '进度把控', '风险管理'],
    expertise: ['项目规划', '资源调配'],
    status: 'busy',
    currentTaskId: 't6',
    mood: 'focused',
    stats: {
      tasksCompleted: 203,
      avgResponseTime: 1.2,
      satisfaction: 4.6,
    },
  },
];

// 任务数据 - 现在属于项目
const tasksData: Task[] = [
  {
    id: 't1',
    title: '重构登录模块',
    description: '优化登录流程，增加多因素认证',
    status: 'in_progress',
    priority: 'high',
    assigneeId: '1', // 小虾
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-20T10:00:00Z',
    startedAt: '2026-05-21T09:00:00Z',
    estimatedHours: 16,
    actualHours: 10,
    progress: 65,
    tags: ['后端', '安全'],
  },
  {
    id: 't2',
    title: 'Q2财报分析',
    description: '分析第二季度财务数据，生成可视化报告',
    status: 'todo',
    priority: 'urgent',
    assigneeId: '2', // 小贝
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-22T14:00:00Z',
    dueDate: '2026-05-25T18:00:00Z',
    estimatedHours: 8,
    actualHours: 0,
    progress: 0,
    tags: ['数据分析', '报表'],
  },
  {
    id: 't3',
    title: '产品文档撰写',
    description: '编写新版产品功能说明文档',
    status: 'review',
    priority: 'medium',
    assigneeId: '3', // 小文
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-18T09:00:00Z',
    startedAt: '2026-05-19T10:00:00Z',
    estimatedHours: 12,
    actualHours: 11,
    progress: 90,
    tags: ['文档', '产品'],
  },
  {
    id: 't4',
    title: 'API性能优化',
    description: '优化核心API响应时间，目标<100ms',
    status: 'done',
    priority: 'high',
    assigneeId: '1', // 小虾
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-15T08:00:00Z',
    startedAt: '2026-05-16T09:00:00Z',
    completedAt: '2026-05-19T17:00:00Z',
    estimatedHours: 20,
    actualHours: 18,
    progress: 100,
    tags: ['后端', '性能'],
  },
  {
    id: 't5',
    title: '用户调研报告',
    description: '整理用户反馈，输出调研报告',
    status: 'backlog',
    priority: 'low',
    assigneeId: '3', // 小文
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-23T11:00:00Z',
    estimatedHours: 6,
    actualHours: 0,
    progress: 0,
    tags: ['调研', '文档'],
  },
  {
    id: 't6',
    title: '项目进度同步',
    description: '整理各项目进度，准备周会材料',
    status: 'in_progress',
    priority: 'medium',
    assigneeId: '4', // 小管
    creator: { id: 'user1', name: '灵长目院士' },
    createdAt: '2026-05-23T08:00:00Z',
    startedAt: '2026-05-23T09:00:00Z',
    estimatedHours: 4,
    actualHours: 2,
    progress: 50,
    tags: ['管理', '会议'],
  },
];

// 项目数据 - 包含任务
export const fakeProjects: Project[] = [
  {
    id: 'p1',
    name: 'DeepClaw 系统重构',
    description: '对 DeepClaw 系统进行全面的架构升级和性能优化',
    status: 'active',
    tasks: tasksData.filter(t => ['t1', 't4'].includes(t.id)),
    createdAt: '2026-05-01T08:00:00Z',
    updatedAt: '2026-05-23T10:00:00Z',
    owner: { id: 'user1', name: '灵长目院士' },
    memberIds: ['1', '4'],
  },
  {
    id: 'p2',
    name: 'Q2 财务分析',
    description: '第二季度财务数据分析和报告生成',
    status: 'active',
    tasks: tasksData.filter(t => ['t2'].includes(t.id)),
    createdAt: '2026-05-15T09:00:00Z',
    updatedAt: '2026-05-22T14:00:00Z',
    owner: { id: 'user1', name: '灵长目院士' },
    memberIds: ['2'],
  },
  {
    id: 'p3',
    name: '产品文档更新',
    description: '更新产品文档和用户手册',
    status: 'active',
    tasks: tasksData.filter(t => ['t3', 't5'].includes(t.id)),
    createdAt: '2026-05-10T10:00:00Z',
    updatedAt: '2026-05-19T10:00:00Z',
    owner: { id: 'user1', name: '灵长目院士' },
    memberIds: ['3'],
  },
  {
    id: 'p4',
    name: '项目管理优化',
    description: '优化项目管理流程和协作机制',
    status: 'active',
    tasks: tasksData.filter(t => ['t6'].includes(t.id)),
    createdAt: '2026-05-20T08:00:00Z',
    updatedAt: '2026-05-23T09:00:00Z',
    owner: { id: 'user1', name: '灵长目院士' },
    memberIds: ['4'],
  },
];

// 兼容旧代码的导出
export const fakeTasks: Task[] = tasksData;

export const fakeMessages: Message[] = [
  {
    id: 'm1',
    agentId: '1',
    content: '这个登录重构任务，我需要先分析一下现有代码结构。',
    type: 'thought',
    timestamp: '2026-05-21T09:05:00Z',
  },
  {
    id: 'm2',
    agentId: '1',
    content: '预计需要2天完成，目前已完成65%，还剩测试和文档工作。',
    type: 'agent',
    timestamp: '2026-05-21T09:06:00Z',
  },
  {
    id: 'm3',
    agentId: '1',
    content: '进度不错，继续保持！',
    type: 'user',
    timestamp: '2026-05-21T09:10:00Z',
  },
];

export const getAgentById = (id: string) => fakeAgents.find(a => a.id === id);
export const getTasksByAgentId = (agentId: string) => {
  const allTasks: Task[] = [];
  fakeProjects.forEach(p => {
    allTasks.push(...p.tasks.filter(t => t.assigneeId === agentId));
  });
  return allTasks;
};
export const getMessagesByAgentId = (agentId: string) => fakeMessages.filter(m => m.agentId === agentId);
export const getProjectById = (id: string) => fakeProjects.find(p => p.id === id);
export const getTaskById = (id: string) => tasksData.find(t => t.id === id);
