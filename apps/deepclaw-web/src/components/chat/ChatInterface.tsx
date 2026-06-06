'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { formatDate } from '@/lib/utils';
import { invoke } from '@/lib/invoke';
import { Send } from 'lucide-react';
import { AgentEmployee } from '@/types';

interface ChatInterfaceProps {
  agentId: string;
  agents: AgentEmployee[];
}

export function ChatInterface({ agentId, agents }: ChatInterfaceProps) {
  const { messages, addMessage } = useAppStore();
  const [input, setInput] = useState('');
  
  const agent = agents.find((a) => a.id === agentId);
  const agentMessages = messages.filter((m) => m.agentId === agentId);
  
  if (!agent) {
    return (
      <div className="flex flex-col h-full bg-white items-center justify-center text-gray-400">
        <p>未找到 Agent 信息</p>
      </div>
    );
  }

  const handleSend = async () => {
    if (!input.trim()) return;
    // TODO: 实际发送消息
    setInput('');
    addMessage({
      id: Date.now().toString(),
      agentId,
      content: input.trim(),
      type: 'user',
      timestamp: new Date().toISOString(),
    });
     const r = await invoke(input.trim());
      addMessage({
        id: Date.now().toString(),
        agentId,
        content: r,
        type: 'agent',
        timestamp: new Date().toISOString(),
      });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-xl">
          {agent.avatar}
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">{agent.name}</h3>
          <p className="text-xs text-gray-500">{agent.role}</p>
        </div>
      </div>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {agentMessages.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p>还没有消息</p>
            <p className="text-sm mt-1">开始和 {agent.name} 对话吧</p>
          </div>
        ) : (
          agentMessages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`
                  max-w-[80%] rounded-2xl px-4 py-3
                  ${message.type === 'user' 
                    ? 'bg-blue-500 text-white' 
                    : message.type === 'thought'
                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                    : 'bg-gray-100 text-gray-800'
                  }
                `}
              >
                {message.type === 'thought' && (
                  <div className="flex items-center gap-1 text-xs text-purple-500 mb-1">
                    <span>💭</span>
                    <span>思考中</span>
                  </div>
                )}
                <p className="text-sm">{message.content}</p>
                <p className={`text-xs mt-1 ${message.type === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {formatDate(message.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* Input */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={`给 ${agent.name} 发消息...`}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
