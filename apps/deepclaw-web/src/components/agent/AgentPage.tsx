'use client';

import { useEffect, useState } from 'react';
import { AgentList } from '@/components/agent/AgentList';
import { AgentDetail } from '@/components/agent/details/AgentDetail';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useAppStore } from '@/lib/store';
import { MessageSquare, ArrowLeft } from 'lucide-react';
import { AgentEmployee, Project, Task } from '@deepclaw/loop-gateway';
import { useTranslation } from 'react-i18next';
import { ChatSidebar } from '../chat/ChatSidebar';

type MobileView = 'list' | 'detail' | 'chat';

export function AgentPage({agents, projects}: {agents: AgentEmployee[], projects: Project<Task>[]}) {
  const { selectedAgentId, setSelectedAgent } = useAppStore();
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const {t} = useTranslation();

  useEffect(() => {
    if (!agents.some(agent => agent.id === selectedAgentId)) {
      setSelectedAgent(agents[0].id);
    }
  }, [agents, selectedAgentId, setSelectedAgent]);

  const agent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-full flex">
      {/* Desktop Layout */}
      <div className="hidden lg:flex h-full w-full">
        {/* Left: Agent List */}
        <div className="w-80 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
          <AgentList projects={projects} agents={agents} />
        </div>

        {/* Middle: Agent Detail */}
        <div className="flex-1 border-r border-gray-200 overflow-hidden">
          <AgentDetail agent={agent} projects={projects} />
        </div>

        {/* Right: Chat */}
        <ChatSidebar
          from={'agent'}
          agent={agent}
        />
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex-1 flex flex-col h-full overflow-hidden">
        {/* Mobile Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
          {mobileView === 'detail' && (
            <button
              onClick={() => setMobileView('list')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>{t('pages.agents.mobile.returnToList')}</span>
            </button>
          )}
          {mobileView === 'chat' && (
            <button
              onClick={() => setMobileView('detail')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>{t('pages.agents.mobile.returnToDetail')}</span>
            </button>
          )}
          
          {mobileView === 'detail' && selectedAgentId && (
            <button
              onClick={() => setMobileView('chat')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
            >
              <MessageSquare size={16} />
              <span>{t('pages.chat.type.agent.title')}</span>
            </button>
          )}
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-hidden">
          {/* Agent List View */}
          {mobileView === 'list' && (
            <div className="h-full bg-gray-50 p-4 overflow-y-auto">
              <AgentList projects={projects} agents={agents} onSelect={() => setMobileView('detail')} />
            </div>
          )}

          {/* Agent Detail View */}
          {mobileView === 'detail' && (
            <div className="h-full overflow-hidden">
              <AgentDetail agent={agent} projects={projects} />
            </div>
          )}

          {/* Chat View */}
          {mobileView === 'chat' && (
            <div className="h-full bg-white overflow-hidden">
              {selectedAgentId ? (
                <ChatPanel
                  from={'agent'}
                  agent={agent!}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                  <div className="text-4xl mb-4">👋</div>
                  <p className="text-center">{t('pages.agents.mobile.selectAgent')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
