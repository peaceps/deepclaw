'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from "lucide-react";
import { AgentEmployee } from '@deepclaw/loop-gateway';
import { ChatPanel } from './ChatPanel';
import { statusColors } from '../styles-mapping';

type ChatSidebarProps = {
  agent?: AgentEmployee;
  from: 'agent' | 'project';
};

export function ChatSidebar({
  agent,
  from,
}: ChatSidebarProps) {
  const [isCollapsed, setChatCollapsed] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      className={`border-gray-200 bg-white transition-all duration-300 flex flex-col min-h-0 ${isCollapsed ? 'w-12 h-12 lg:h-auto' : 'w-full lg:w-96 h-96 lg:h-full'}`}
    >
      <div className={`flex items-center border-b border-gray-200 bg-gray-50 ${isCollapsed ? 'justify-center py-3' : 'justify-between px-4 py-3'}`}>
        <button
          onClick={() => setChatCollapsed(pre => !pre)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          title={isCollapsed ? t('common.toggle.expand') : t('common.toggle.collapse')}
        >
          {isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            {<MessageSquare size={18} className="text-gray-600" />}
            <span className="font-medium text-gray-700">{t(`pages.chat.type.${from}.title`)}</span>
          </div>
        )}
      </div>

      {!isCollapsed ? (
        <div className="flex-1 flex flex-col overflow-hidden">{
            agent ? (
                <ChatPanel agent={agent} from={from}/>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
                    <div className="text-5xl mb-4">👋</div>
                    <h2 className="text-lg font-semibold text-gray-700 mb-2">{t('pages.chat.welcome.title')}</h2>
                    <p className="text-sm text-center">{t('pages.chat.welcome.description')}</p>
                </div>
            )
        }</div>
      ) : (
        <div className="flex-1 flex flex-col items-center py-4 space-y-4">
          <div className="text-gray-400">{<MessageSquare size={20} />}</div>
          {agent ? (
            <>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-sm">
              {agent.avatar}
            </div>
            <div className={`w-2 h-2 rounded-full ${statusColors[agent.status]}`} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
