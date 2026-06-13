import { useEffect, useRef, useState } from "react";
import { AgentEmployee } from "@deepclaw/core";
import {AgentThoughts} from './AgentThoughts';

type TooltipProps = {
    agent: AgentEmployee;
    visible: boolean;
    anchorRef: React.RefObject<HTMLDivElement | null>;
    onClose: () => void;
}

export function AgentTooltip({ agent, visible, anchorRef, onClose }: TooltipProps) {
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
