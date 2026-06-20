'use client';

import { AgentEmployee } from "@deepclaw/core";
import { Send } from 'lucide-react';
import { invoke } from '@/server/loop';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore } from '@/lib/store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';
import { formatDate } from '../component-utils';
import { getLogger } from "@/lib/logger";
import type { SSEConnectedEvent, SSELoopStreamEvent } from '@/app/api/sse-server';

type ChatPanelProps = {
  agent: AgentEmployee;
  projectId: string;
};

const logger = getLogger('ChatPanel');

export function ChatPanel({ agent, projectId }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const { addMessage, updateMessageStream, getChatMessages } = useAppStore();
  const agentMessages = getChatMessages(agent.id, projectId);
  const { t, i18n } = useTranslation();

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    addMessage('user', agent.id, projectId, trimmed);
    addMessage('agent', agent.id, projectId, '');
    try {
      await invoke(agent.id, projectId, trimmed);
    } catch (e: any) {
      updateMessageStream(`${agent.id}.${projectId}`, `\n${e?.message?.toString() || t('pages.chat.invoke.error')}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        handleSend();
      }
    }
  };

  useEffect(() => {
    const eventSource = new EventSource(`/api/loop?agentId=${agent.id}&projectId=${projectId}`);

    eventSource.addEventListener('connected', (event) => {
      const {clientId} = JSON.parse(event.data) as Extract<SSEConnectedEvent, {sseType: 'connected'}>;
      logger.info(`Connected for ${clientId}.`);
    });
    eventSource.addEventListener('streamText', (event) => {
      const {chatKey, content} = JSON.parse(event.data) as Extract<SSELoopStreamEvent, {sseType: 'streamText'}>;
      updateMessageStream(chatKey, content);
    });

    return () => eventSource.close();
  }, [updateMessageStream, agent.id, projectId]);

  if (agent.fired) {
    return <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">{t('pages.chat.noAgent.title')}</h2>
        <p className="text-sm text-center">{t('pages.chat.noAgent.description')}</p>
    </div>
  }

  return (
    <div className="flex flex-col h-full bg-white min-h-140">
      {<ChatHeader agent={agent} />}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!agentMessages?.length ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm mt-1">{t(`pages.chat.type.${!projectId ? 'agent' : 'project'}.emptyPrompt`, {name: agent.name})}</p>
          </div>
        ) : (
          agentMessages.map((message) => message.content && (
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
                  {formatDate(i18n.language, message.timestamp)}
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
            onKeyDown={handleKeyDown}
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
