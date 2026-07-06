'use client';

import { useState } from "react";
import { AgentEmployee } from "@deepclaw/core";
import { AgentList } from "./AgentList";
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { AgentDetail } from "./details/AgentDetail";
import { useTranslation } from "react-i18next";
import { ChatSidebar } from "../chat/ChatSidebar";

export function DesktopAgentPage({selectedAgent}: {
    selectedAgent?: AgentEmployee;
}) {

  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const {t} = useTranslation();

    return (
      <div className="flex h-full w-full">
        {/* Left: Agent List */}
        <div className={`border-r border-gray-200 bg-gray-50 overflow-hidden shrink-0
            transition-[width] duration-300 ease-in-out ${listCollapsed ? 'w-24' : 'w-80'}`
          }>
          <AgentList
            collapsed={listCollapsed}
            onToggleCollapse={() => setListCollapsed(!listCollapsed)}
          />
        </div>

        {/* Middle: Agent Detail */}
        <div className={`flex flex-col items-center border-r border-gray-200 bg-gray-50 h-full
            overflow-hidden transition-[width] duration-300 ease-in-out
            ${detailCollapsed ? 'w-12' : 'w-[50%]'}`
          }>
          <div className={`flex items-center border-b border-gray-200 bg-gray-50 w-full shrink-0
            ${detailCollapsed ? 'flex-col' : 'justify-end'} py-3`
          }>
            <button
              onClick={() => setDetailCollapsed(!detailCollapsed)}
              className={`p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600
                transition-colors cursor-pointer ${detailCollapsed ? '' : 'mr-2'}`
              }
              title={detailCollapsed ? t('web.toggle.expand') : t('web.toggle.collapse')}
            >
              {detailCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {detailCollapsed ? (
            <div className="bg-gray-50 text-gray-400 py-3">
                <User size={20} />
            </div>
          ) : (
          <div className="flex-1 overflow-hidden w-full">
            <AgentDetail agent={selectedAgent}/>
          </div>
          )}
        </div>

        {selectedAgent && <ChatSidebar
          projectId=""
          agent={selectedAgent}
        />}
      </div>
    );
}
