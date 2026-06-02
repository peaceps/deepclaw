'use client';

import { useState } from 'react';
import { AgentList } from '@/components/agent/AgentList';
import { AgentDetail } from '@/components/agent/AgentDetail';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { useAppStore } from '@/lib/store';
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';

export default function Home() {
  const { selectedAgentId } = useAppStore();
  const [chatCollapsed, setChatCollapsed] = useState(false); // 默认展开

  return (
    <div className="h-full flex">
      {/* Left: Agent List */}
      <div className="w-80 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
        <AgentList />
      </div>

      {/* Middle: Agent Detail */}
      <div className="flex-1 border-r border-gray-200 overflow-hidden">
        <AgentDetail />
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
          {/* 收起按钮放左边 */}
          <button
            onClick={() => setChatCollapsed(!chatCollapsed)}
            className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
            title={chatCollapsed ? '展开聊天栏' : '收起聊天栏'}
          >
            {chatCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
          {/* 标题放右边 */}
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
          <div className="flex-1 overflow-y-auto p-4">
            {selectedAgentId ? (
              <ChatInterface agentId={selectedAgentId} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
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
  );
}
