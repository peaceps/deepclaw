'use client';

import { useState } from "react";
import { AgentEmployee } from "@deepclaw/core";
import { AgentList } from "./AgentList";
import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { AgentDetail } from "./details/AgentDetail";
import { useTranslation } from "react-i18next";
import type { Project, Task } from "@deepclaw/loop-gateway";
import { ChatSidebar } from "../chat/ChatSidebar";

export function DesktopAgentPage({projects, agents, selectedAgent}: {
    projects: Project<Task>[];
    agents: AgentEmployee[];
    selectedAgent?: AgentEmployee;
}) {

  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const {t} = useTranslation();

    return (
      <div className="flex h-full w-full">
        {/* Left: Agent List */}
        <div className="w-80 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
          <AgentList projects={projects} agents={agents} />
        </div>

        {/* Middle: Agent Detail */}
        <div className={`flex flex-col items-center border-r border-gray-200 bg-gray-50 transition-all duration-300 h-full ${detailCollapsed ? 'w-12' : 'w-[50%]'}`}>
          <div className={`flex items-center border-b border-gray-200 bg-gray-50 w-full ${detailCollapsed ? 'flex-col' : 'justify-end'} py-3`}>
            <button
              onClick={() => setDetailCollapsed(!detailCollapsed)}
              className={`p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors ${detailCollapsed ? '' : 'mr-2'}`}
              title={detailCollapsed ? t('common.toggle.expand') : t('common.toggle.collapse')}
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
                <AgentDetail agent={selectedAgent} projects={projects} />
            </div>
          )}
        </div>

        {selectedAgent && <ChatSidebar
          from={'agent'}
          agent={selectedAgent}
        />}
      </div>
    );
}
