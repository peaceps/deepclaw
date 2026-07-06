import { AgentEmployee } from "@deepclaw/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {avatarBG, moodEmojis} from '../styles-mapping';
import { AgentActionMenu } from '@/components/agent/AgentActionMenu';

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
      const handleScroll = () => onClose();
  
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }, [visible, onClose]);
  
    if (!visible || agent.fired) return null;
  
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
          <AgentActionMenu className="right-0 top-0" />
          <div className="flex items-start gap-3 mb-3 pr-8">
            <div className={`w-12 h-12 rounded-full ${avatarBG} flex items-center justify-center text-2xl`}>
              {agent.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-gray-900 truncate">{agent.name}<span className="text-sm ml-1">{moodEmojis[agent.mood]}</span></h4>
              <p className="text-sm text-gray-500 truncate">{agent.role}</p>
            </div>
          </div>
  
        {/* 个性特征 */}
        <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">{t('pages.agents.details.personality.title')}</p>
            <div className="flex flex-wrap gap-1">
            {agent.personalities.map((personality) => (
                <span
                key={personality}
                className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full"
                >
                {personality}
                </span>
            ))}
            </div>
        </div>
  
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">{t('pages.agents.details.expertises.title')}</p>
            <div className="flex flex-wrap gap-1">
              {agent.expertises?.slice(0, 4).map((expertise) => (
                <span
                  key={expertise}
                  className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full"
                >
                  {expertise}
                </span>
              ))}
            </div>
          </div>
  
          {/* 气泡文本 */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-3 border border-blue-100">
            <div className="flex items-start gap-2">
              <span className="text-lg">💬</span>
              <p className="text-sm text-gray-700 italic">
                &quot;{t('web.iam', {name: agent.name, expertises: agent.expertises.join('/') || t('web.all')})}&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    );
}
