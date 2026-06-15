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
        className="fixed z-50 bg-white rounded-xl shadow-xl border-2 border-green-200 p-4 w-56"
        style={{
          top: position.top,
          left: position.left,
          transform: 'translateX(-50%)',
        }}
      >
        {/* 箭头 - 根据位置调整方向 */}
        <div 
          className={`absolute left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-green-200 rotate-45 ${
            isTopPlacement 
              ? '-bottom-2 border-b-2 border-r-2' 
              : '-top-2 border-l-2 border-t-2'
          }`} 
        />
          <AgentThoughts agent={agent} />
      </div>
    );
}
