'use client';

import { AgentList } from '@/components/agent/AgentList';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { useAppStore } from '@/lib/store';

export default function Home() {
  const { selectedAgentId } = useAppStore();

  return (
    <div className="h-full flex">
      {/* Left: Agent List */}
      <div className="w-80 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
        <AgentList />
      </div>
      
      {/* Right: Chat or Welcome */}
      <div className="flex-1 p-6">
        {selectedAgentId ? (
          <ChatInterface agentId={selectedAgentId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400">
            <div className="text-6xl mb-4">👋</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">欢迎使用 DeepClaw</h2>
            <p className="text-sm">从左侧选择一个 Agent 开始对话</p>
          </div>
        )}
      </div>
    </div>
  );
}
