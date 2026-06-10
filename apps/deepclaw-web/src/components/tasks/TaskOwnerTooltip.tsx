import { AgentEmployee } from "@/types";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {moodEmojis} from '../styles-mapping';

export function TaskOwnerTooltip({ agent, visible, anchorRef, onClose }: {
    agent: AgentEmployee;
    visible: boolean;
    anchorRef: React.RefObject<HTMLDivElement | null>;
    onClose: () => void;
  }) {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const {t} = useTranslation();
    
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
            <p className="text-xs text-gray-500 mb-1">{t('pages.agents.details.skills.title')}</p>
            <div className="flex flex-wrap gap-1">
              {agent.skills?.slice(0, 4).map((skill) => (
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
              <div className="text-xs text-gray-500">{t('pages.agents.card.finishedTasks', {count: agent.stats.tasksCompleted})}</div>
            </div>
          </div>
  
          {/* 个性特征 */}
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">{t('pages.agents.details.personality.title')}</p>
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
                &quot;{t('common.iam', {name: agent.name, skills: agent.expertise?.join('/') || t('common.all')})}&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    );
}
