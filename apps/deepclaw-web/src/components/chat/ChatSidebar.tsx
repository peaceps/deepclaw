'use client';

import { useTranslation } from 'react-i18next';
import { MessageSquare } from "lucide-react";
import { AgentEmployee } from "@deepclaw/core";
import { ChatPanel } from './ChatPanel';

type ChatSidebarProps = {
  agent: AgentEmployee;
  from: 'agent' | 'project';
};

export function ChatSidebar({
  agent,
  from,
}: ChatSidebarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col lg:flex-1 border-gray-200 bg-white transition-all duration-300 w-full h-full"
    >
      <div className={`flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3`}>
          <div className="flex items-center gap-2">
            {<MessageSquare size={18} className="text-gray-600" />}
            <span className="font-medium text-gray-700">{t(`pages.chat.type.${from}.title`)}</span>
          </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
          <ChatPanel agent={agent} from={from}/>
      </div>
    </div>
  );
}
