'use client';

import { useState, useRef, useEffect } from 'react';
import { AgentEmployee } from '@/types';
import { statusColors, statusLabels, moodEmojis } from '@/lib/utils';
// import { useAppStore } from '@/lib/store';

// 显示当前任务的子组件
// function AgentCurrentTask({ taskId }: { taskId: string }) {
//   const { getAllTasks } = useAppStore();
//   const tasks = getAllTasks();
//   const task = tasks.find(t => t.title === taskId);

//   if (!task) return null;

//   return (
//     <div className="mt-3 pt-3 border-t border-gray-100">
//       <p className="text-xs text-gray-500 mb-1">当前任务</p>
//       <p className="text-sm font-medium text-gray-700 truncate">{task.title}</p>
//       <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
//         <div
//           className="h-full bg-blue-500 rounded-full transition-all"
//           style={{ width: `${task.progress}%` }}
//         />
//       </div>
//     </div>
//   );
// }

// 根据心情和状态生成想法
function getAgentThoughts(agent: AgentEmployee): { emoji: string; text: string; color: string } {
  const thoughts: Record<string, string[]> = {
    happy: [
      '今天心情不错，工作很有干劲！',
      '这个任务挺有意思的，我喜欢！',
      '状态很好，准备大干一场！',
      '今天效率应该会很高~',
    ],
    focused: [
      '正在专注处理任务，请勿打扰',
      '思路很清晰，继续推进中',
      '进入心流状态了，感觉很好',
      '集中精力，争取早点完成',
    ],
    tired: [
      '好累啊，需要休息一下...',
      '连续工作好久了，有点疲惫',
      '眼皮在打架，需要咖啡续命',
      '这个工作有点枯燥，想摸鱼',
    ],
    confused: [
      '这个需求有点看不懂...',
      '有点懵，需要再理清楚思路',
      '遇到了一些困难，正在思考',
      '这个问题有点复杂，需要点时间',
    ],
  };

  const busyThoughts = [
    '忙死了，任务堆成山了！',
    '手头事情好多，压力有点大',
    '正在赶进度，时间不够用啊',
    '这个 deadline 有点紧张...',
  ];

  const idleThoughts = [
    '有点闲，有什么任务给我吗？',
    '等待分配新任务中...',
    '手头暂时没事，随时待命',
    '空闲时间，可以接新任务了',
  ];

  // 根据状态和心情选择想法
  let thoughtPool = thoughts[agent.mood] || thoughts.focused;
  
  if (agent.status === 'busy') {
    thoughtPool = [...thoughtPool, ...busyThoughts];
  } else if (agent.status === 'idle') {
    thoughtPool = [...thoughtPool, ...idleThoughts];
  }

  // 根据 agent id 和当前时间选择一个想法（保持一致性）
  const seed = parseInt(agent.id) + new Date().getHours();
  const thought = thoughtPool[seed % thoughtPool.length];

  const colors: Record<string, string> = {
    happy: 'from-yellow-50 to-orange-50 border-yellow-200',
    focused: 'from-blue-50 to-indigo-50 border-blue-200',
    tired: 'from-gray-50 to-slate-50 border-gray-300',
    confused: 'from-purple-50 to-pink-50 border-purple-200',
  };

  const emojis: Record<string, string> = {
    happy: '😊',
    focused: '🎯',
    tired: '😴',
    confused: '🤔',
  };

  return {
    emoji: emojis[agent.mood] || '💭',
    text: thought,
    color: colors[agent.mood] || 'from-gray-50 to-gray-100 border-gray-200',
  };
}

function AgentThoughts({ agent }: { agent: AgentEmployee }) {
  const { emoji, text, color } = getAgentThoughts(agent);

  return (
    <div className={`bg-gradient-to-r ${color} rounded-lg p-3 border`}>
      <div className="flex items-start gap-2">
        <span className="text-xl">{emoji}</span>
        <div className="flex-1">
          <p className="text-sm text-gray-700 font-medium">{text}</p>
          <p className="text-xs text-gray-400 mt-1">
            {agent.mood === 'happy' && '心情不错'}
            {agent.mood === 'focused' && '专注工作中'}
            {agent.mood === 'tired' && '有点疲惫'}
            {agent.mood === 'confused' && '需要思考'}
            {' · '}
            {agent.status === 'busy' && '忙碌'}
            {agent.status === 'online' && '在线'}
            {agent.status === 'idle' && '空闲'}
            {agent.status === 'offline' && '离线'}
          </p>
        </div>
      </div>
    </div>
  );
}

interface AgentCardProps {
  agent: AgentEmployee;
  isSelected?: boolean;
  onClick?: () => void;
}

interface TooltipProps {
  agent: AgentEmployee;
  visible: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

function AgentTooltip({ agent, visible, anchorRef, onClose }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' as 'top' | 'bottom' });

  useEffect(() => {
    if (visible && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const tooltipHeight = 200; // 预估气泡高度
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // 如果下方空间不足且上方空间足够，则显示在上方
      const placement = (spaceBelow < tooltipHeight && spaceAbove > tooltipHeight) ? 'top' : 'bottom';
      
      setPosition({
        top: placement === 'bottom' ? rect.bottom + 8 : rect.top - tooltipHeight - 8,
        left: rect.left + rect.width / 2,
        placement,
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

  const isTopPlacement = position.placement === 'top';

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
      {/* 箭头 - 根据位置调整方向 */}
      <div 
        className={`absolute left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-gray-200 rotate-45 ${
          isTopPlacement 
            ? '-bottom-2 border-b border-r' 
            : '-top-2 border-l border-t'
        }`} 
      />

      <div className="relative">
        {/* 头部 - 只显示基本信息 */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xl">
            {agent.avatar}
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-gray-900">{agent.name}</h4>
            <p className="text-xs text-gray-500">{agent.role}</p>
          </div>
        </div>

        {/* 心情和想法 - 只保留这个 */}
        <AgentThoughts agent={agent} />
      </div>
    </div>
  );
}

export function AgentCard({ agent, isSelected, onClick }: AgentCardProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(true);
    onClick?.();
  };

  return (
    <>
      <div
        ref={cardRef}
        onClick={handleClick}
        className={`
          p-4 rounded-xl border-2 cursor-pointer transition-all
          ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
        `}
      >
        <div className="flex items-start gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-2xl">
              {agent.avatar}
            </div>
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${statusColors[agent.status]}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
              <span className="text-sm">{moodEmojis[agent.mood]}</span>
            </div>
            <p className="text-sm text-gray-500">{agent.role}</p>
            <p className="text-xs text-gray-400 mt-1">{agent.department}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className={`px-2 py-1 rounded-full ${statusColors[agent.status].replace('bg-', 'bg-opacity-20 bg-')} text-gray-600`}>
            {statusLabels[agent.status]}
          </span>
          <span className="text-gray-400">
            已完成 {agent.stats.tasksCompleted} 个任务
          </span>
        </div>

        {
        // agent.currentTaskId && (
        //   <AgentCurrentTask taskId={agent.currentTaskId} />
        // )
        }
      </div>

      <AgentTooltip
        agent={agent}
        visible={tooltipVisible}
        anchorRef={cardRef}
        onClose={() => setTooltipVisible(false)}
      />
    </>
  );
}
