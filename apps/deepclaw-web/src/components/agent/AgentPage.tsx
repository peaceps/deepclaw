'use client';

import { useState } from 'react';
import { AgentList } from '@/components/agent/AgentList';
import { AgentDetail } from '@/components/agent/AgentDetail';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { useAppStore } from '@/lib/store';
import { ChevronLeft, ChevronRight, MessageSquare, ArrowLeft, X } from 'lucide-react';
import { AgentEmployee } from '@deepclaw/gateway';

type MobileView = 'list' | 'detail' | 'chat';

export function AgentPage({agents}: {agents: AgentEmployee[]}) {
  const { selectedAgentId } = useAppStore();
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('list');

  return (
    <div className="h-full flex">
      {/* Desktop Layout */}
      <div className="hidden lg:flex h-full w-full">
        {/* Left: Agent List */}
        <div className="w-80 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
          <AgentList agents={agents} />
        </div>

        {/* Middle: Agent Detail */}
        <div className="flex-1 border-r border-gray-200 overflow-hidden">
          <AgentDetail agents={agents} />
        </div>

        {/* Right: Chat Panel */}
        <div
          className={`
            border-l border-gray-200 bg-white transition-all duration-300 ease-in-out flex flex-col
            ${chatCollapsed ? 'w-12' : 'w-96'}
          `}
        >
          {/* Toggle Button */}
          <div
            className={`
              flex items-center border-b border-gray-200 bg-gray-50
              ${chatCollapsed ? 'justify-center py-3' : 'justify-between px-4 py-3'}
            `}
          >
            <button
              onClick={() => setChatCollapsed(!chatCollapsed)}
              className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
              title={chatCollapsed ? '展开聊天栏' : '收起聊天栏'}
            >
              {chatCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </button>
            {!chatCollapsed && (
              <div className="flex items-center gap-2">
                <MessageSquare size={18} className="text-gray-600" />
                <span className="font-medium text-gray-700">
                  {selectedAgentId ? '对话' : '聊天'}
                </span>
              </div>
            )}
          </div>

          {/* Chat Content */}
          {!chatCollapsed && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedAgentId ? (
                <ChatInterface agentId={selectedAgentId} agents={agents} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
                  <div className="text-5xl mb-4">👋</div>
                  <h2 className="text-lg font-semibold text-gray-700 mb-2">欢迎使用</h2>
                  <p className="text-sm text-center">从左侧选择 Agent<br/>开始对话</p>
                </div>
              )}
            </div>
          )}

          {/* Collapsed State - Icon */}
          {chatCollapsed && (
            <div className="flex-1 flex flex-col items-center py-4 space-y-4">
              <div className="text-gray-400">
                <MessageSquare size={20} />
              </div>
              {selectedAgentId && (
                <div className="w-2 h-2 rounded-full bg-green-500" title="有选中 Agent" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex-1 flex flex-col h-full overflow-hidden">
        {/* Mobile Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
          {mobileView === 'list' && (
            <h1 className="text-lg font-semibold text-gray-900">Agent 员工</h1>
          )}
          {mobileView === 'detail' && (
            <button
              onClick={() => setMobileView('list')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>返回列表</span>
            </button>
          )}
          {mobileView === 'chat' && (
            <button
              onClick={() => setMobileView('detail')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>返回详情</span>
            </button>
          )}
          
          {mobileView === 'detail' && selectedAgentId && (
            <button
              onClick={() => setMobileView('chat')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium"
            >
              <MessageSquare size={16} />
              <span>对话</span>
            </button>
          )}
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-hidden">
          {/* Agent List View */}
          {mobileView === 'list' && (
            <div className="h-full bg-gray-50 p-4 overflow-y-auto">
              <AgentList agents={agents} onSelect={() => setMobileView('detail')} />
            </div>
          )}

          {/* Agent Detail View */}
          {mobileView === 'detail' && (
            <div className="h-full overflow-hidden">
              <AgentDetail agents={agents} />
            </div>
          )}

          {/* Chat View */}
          {mobileView === 'chat' && (
            <div className="h-full bg-white overflow-hidden">
              {selectedAgentId ? (
                <ChatInterface agentId={selectedAgentId} agents={agents} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                  <div className="text-4xl mb-4">👋</div>
                  <p className="text-center">请先选择 Agent</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
