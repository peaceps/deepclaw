'use client';

import { useAppStore } from '@/lib/store';
import { AgentEmployee } from '@/types';
import {
  Briefcase,
  Building2,
  Heart,
  Zap,
  Clock,
  Star,
  Target,
  Users,
  CheckCircle2
} from 'lucide-react';

interface InfoCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function InfoCard({ title, icon, children }: InfoCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-blue-500">{icon}</div>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

interface TraitBadgeProps {
  text: string;
  color?: 'blue' | 'purple' | 'green' | 'orange' | 'gray';
}

function TraitBadge({ text, color = 'blue' }: TraitBadgeProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
  };

  return (
    <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${colorClasses[color]}`}>
      {text}
    </span>
  );
}

function AgentHeader({ agent }: { agent: AgentEmployee }) {
  const moodEmojis: Record<string, string> = {
    happy: '😊',
    focused: '🎯',
    tired: '😴',
    confused: '🤔',
  };

  const statusColors: Record<string, string> = {
    online: 'bg-green-500',
    busy: 'bg-red-500',
    idle: 'bg-yellow-500',
    offline: 'bg-gray-400',
  };

  const statusLabels: Record<string, string> = {
    online: '在线',
    busy: '忙碌',
    idle: '空闲',
    offline: '离线',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="flex items-start gap-4 sm:gap-6">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center text-3xl sm:text-5xl shadow-lg">
            {agent.avatar}
          </div>
          <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-6 sm:h-6 rounded-full border-2 sm:border-3 border-white ${statusColors[agent.status]} shadow-sm`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{agent.name}</h1>
            <span className="text-xl sm:text-2xl">{moodEmojis[agent.mood]}</span>
            <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-medium text-white ${statusColors[agent.status]}`}>
              {statusLabels[agent.status]}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-gray-600 mb-4 text-sm sm:text-base">
            <span className="flex items-center gap-1.5">
              <Briefcase size={14} className="sm:w-4 sm:h-4" />
              {agent.role}
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 size={14} className="sm:w-4 sm:h-4" />
              {agent.department}
            </span>
          </div>

          {/* Stats */}
          <div className="flex gap-4 sm:gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={16} className="sm:w-5 sm:h-5 text-green-600" />
              </div>
              <div>
                <div className="text-base sm:text-lg font-bold text-gray-900">{agent.stats.tasksCompleted}</div>
                <div className="text-xs text-gray-500">完成任务</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Clock size={16} className="sm:w-5 sm:h-5 text-blue-600" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-yellow-50 flex items-center justify-center">
                <Star size={16} className="sm:w-5 sm:h-5 text-yellow-600" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PersonalitySection({ agent }: { agent: AgentEmployee }) {
  const communicationStyleLabels: Record<string, string> = {
    formal: '正式',
    casual: '随意',
    friendly: '友好',
  };

  return (
    <InfoCard title="性格设定" icon={<Heart size={20} />}>
      <div className="space-y-4">
        {/* 性格特征 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">性格特征</label>
          <div className="flex flex-wrap gap-2">
            {agent.personality.traits.map((trait) => (
              <TraitBadge key={trait} text={trait} color="purple" />
            ))}
          </div>
        </div>

        {/* 沟通风格 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">沟通风格</label>
          <TraitBadge
            text={communicationStyleLabels[agent.personality.communicationStyle]}
            color="blue"
          />
        </div>

        {/* 情感表达 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">情感表达</label>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
            agent.personality.emotionExpression
              ? 'bg-pink-50 text-pink-700 border-pink-200'
              : 'bg-gray-100 text-gray-700 border-gray-200'
          }`}>
            {agent.personality.emotionExpression ? '😊 会表达情感' : '😐 理性克制'}
          </span>
        </div>
      </div>
    </InfoCard>
  );
}

function SkillsSection({ agent }: { agent: AgentEmployee }) {
  return (
    <InfoCard title="技能专长" icon={<Zap size={20} />}>
      <div className="space-y-4">
        {/* 技能 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">技能</label>
          <div className="flex flex-wrap gap-2">
            {agent.skills?.map((skill) => (
              <TraitBadge key={skill} text={skill} color="blue" />
            ))}
          </div>
        </div>

        {/* 专业领域 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">专业领域</label>
          <div className="flex flex-wrap gap-2">
            {agent.expertise?.map((exp) => (
              <TraitBadge key={exp} text={exp} color="green" />
            ))}
          </div>
        </div>
      </div>
    </InfoCard>
  );
}

function WorkStyleSection({ agent }: { agent: AgentEmployee }) {
  const { getAllTasks } = useAppStore();
  const tasks = getAllTasks();
  const currentTask = agent.id ? tasks.find(t => t.title === agent.id) : null;

  return (
    <InfoCard title="工作方式" icon={<Target size={20} />}>
      <div className="space-y-4">
        {/* 当前任务 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">当前任务</label>
          {currentTask ? (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">{currentTask.title}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  currentTask.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                  currentTask.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                  currentTask.priority === 'medium' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {currentTask.priority === 'urgent' ? '紧急' :
                   currentTask.priority === 'high' ? '高' :
                   currentTask.priority === 'medium' ? '中' : '低'}
                </span>
              </div>
              <p className="text-sm text-gray-600 line-clamp-2">{currentTask.description}</p>
              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>进度 {currentTask.progress}%</span>
                {/* <span>预计 {currentTask.estimatedHours} 小时</span> */}
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${currentTask.progress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">暂无进行中的任务</div>
          )}
        </div>

        {/* 工作状态说明 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">工作特点</label>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              <span>擅长 {agent.expertise?.join('、') || '所有'} 领域的工作</span>
            </li>
            {/* <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              <span>平均响应时间 {agent.stats.avgResponseTime} 秒，效率较高</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              <span>已完成 {agent.stats.tasksCompleted} 个任务，满意度 {agent.stats.satisfaction}</span>
            </li> */}
          </ul>
        </div>
      </div>
    </InfoCard>
  );
}

export function AgentDetail({agents}: {agents: AgentEmployee[]}) {
  const { selectedAgentId } = useAppStore();

  const agent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  if (!agent) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50">
        <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6">
          <Users size={48} className="text-gray-300" />
        </div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">选择 Agent 查看详情</h2>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          从左侧列表中选择一个 Agent 员工<br />查看其角色设定、性格特点和工作方式
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header */}
        <AgentHeader agent={agent} />

        {/* Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <PersonalitySection agent={agent} />
          <SkillsSection agent={agent} />
        </div>

        {/* Work Style */}
        <WorkStyleSection agent={agent} />
      </div>
    </div>
  );
}
