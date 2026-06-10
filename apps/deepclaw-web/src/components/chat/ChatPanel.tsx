'use client';

import { AgentEmployee } from '@deepclaw/loop-gateway';
import { Send } from 'lucide-react';
import { invoke } from '@/server/loop';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore } from '@/lib/store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type ChatPanelProps = {
  agent: AgentEmployee;
  from: 'agent' | 'project';
};

export function ChatPanel({ agent, from }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const { messages, addMessage } = useAppStore();
  const agentMessages = messages.filter((m) => m.agentId === agent.id);
  const { t } = useTranslation();

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    addMessage({
        id: Date.now().toString(),
        agentId: agent.id,
        content: trimmed,
        type: 'user',
        timestamp: new Date().toISOString(),
    });
    const response = await invoke(trimmed);
    addMessage({
        id: (Date.now() + 1).toString(),
        agentId: agent.id,
        content: response,
        type: 'agent',
        timestamp: new Date().toISOString(),
    });
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {<ChatHeader agent={agent} />}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {agentMessages.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm mt-1">{t(`pages.chat.type.${from}.emptyPrompt`, {name: agent.name})}</p>
          </div>
        ) : (
          agentMessages.map((message) => (
            <div
              key={message.id}
              className={`flex ${messageFlexStyles[message.type]}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    messageTextStyles[message.type]
                }`}
              >
                {message.type === 'thought' && (
                  <div className="flex items-center gap-1 text-xs text-purple-500 mb-1">
                    <span>💭</span>
                    <span>{t('pages.chat.thinking')}</span>
                  </div>
                )}
                <p className="text-sm">{message.content}</p>
                <p className={`text-xs mt-1 ${messageTimeStyles[message.type]}`}>
                  {formatDate(message.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-4 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('pages.chat.send', { name: agent.name })}
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
