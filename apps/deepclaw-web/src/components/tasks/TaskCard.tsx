'use client';

import { useState, useRef, useEffect } from 'react';
import { Task, AgentEmployee } from '@/types';
import { priorityColors, priorityLabels, formatDuration, statusColors, moodEmojis } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

interface TaskCardProps {
  task: Task;
}

// 复杂版本的气泡组件
function AgentDetailTooltip({ agent, visible, anchorRef, onClose }: {
  agent: AgentEmployee;
  visible: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (visible && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [visible, anchorRef]);

  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onClose]);

  if (!visible) return null;

  const statusLabels: Record<string, string> = {
    online: '在线',
    busy: '忙碌',
    idle: '空闲',
    offline: '离线',
  };

  return (
    <div
      ref={tooltipRef}
      className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-72"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
      }}
    >
      {/* 箭头 */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-l border-t border-gray-200 rotate-45" />

      <div className="relative">
        {/* 头部 */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
            {agent.avatar}
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-gray-900">{agent.name}</h4>
            <p className="text-sm text-gray-500">{agent.role}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm">{moodEmojis[agent.mood]}</span>
              <span className="text-xs text-gray-400">{agent.department}</span>
            </div>
          </div>
        </div>

        {/* 技能标签 */}
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">技能</p>
          <div className="flex flex-wrap gap-1">
            {agent.skills.slice(0, 4).map((skill) => (
              <span
                key={skill}
                className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        {/* 统计数据 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-gray-900">{agent.stats.tasksCompleted}</div>
            <div className="text-xs text-gray-500">完成任务</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-gray-900">{agent.stats.avgResponseTime}s</div>
            <div className="text-xs text-gray-500">平均响应</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-gray-900">{agent.stats.satisfaction}</div>
            <div className="text-xs text-gray-500">满意度</div>
          </div>
        </div>

        {/* 个性特征 */}
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-1">个性特征</p>
          <div className="flex flex-wrap gap-1">
            {agent.personality.traits.map((trait) => (
              <span
                key={trait}
                className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full"
              >
                {trait}
              </span>
            ))}
          </div>
        </div>

        {/* 气泡文本 */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-3 border border-blue-100">
          <div className="flex items-start gap-2">
            <span className="text-lg">💬</span>
            <p className="text-sm text-gray-700 italic">
              "我是{agent.name}，擅长{agent.expertise.join('、')}，随时准备为您服务！"
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskCard({ task }: TaskCardProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const { getTaskAssignee } = useAppStore();
  
  const assignee = getTaskAssignee(task.assigneeId);

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (assignee) {
      setTooltipVisible(true);
    }
  };

  if (!assignee) return null;

  return (
    <>
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-gray-900 line-clamp-2 flex-1">{task.title}</h4>
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${priorityColors[task.priority]}`}>
            {priorityLabels[task.priority]}
          </span>
        </div>

        <p className="text-sm text-gray-500 mt-2 line-clamp-2">{task.description}</p>

        {/* Assignee - 可点击 */}
        <div
          ref={assigneeRef}
          onClick={handleAssigneeClick}
          className="mt-3 flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded-lg p-1 -ml-1 transition-colors"
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xs">
            {assignee.avatar}
          </div>
          <span className="text-xs text-gray-600">{assignee.name}</span>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-3">
            <span>⏱️ {formatDuration(task.estimatedHours)}</span>
            {task.dueDate && (
              <span>📅 {new Date(task.dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
            )}
          </div>
          <div className="flex gap-1">
            {task.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {task.status === 'in_progress' && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-500">进度</span>
              <span className="font-medium text-gray-700">{task.progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 复杂版本气泡 */}
      <AgentDetailTooltip
        agent={assignee}
        visible={tooltipVisible}
        anchorRef={assigneeRef}
        onClose={() => setTooltipVisible(false)}
      />
    </>
  );
}
