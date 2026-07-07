'use client';

import { AgentEmployee } from "@deepclaw/core";
import { Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore, getChatKey } from '@/lib/store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';
import { formatDate } from '../component-utils';
import { Markdown } from "./Markdown";
import { useInitChat, useSSEConnection, useScroll, useSend } from "./use-chat-hooks";

type ChatPanelProps = {
  agent: AgentEmployee;
  projectId: string;
};

export function ChatPanel({ agent, projectId }: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const chatKey = getChatKey(agent.id, projectId);
  const [previousChatKey, setPreviousChatKey] = useState(chatKey);
  const agentMessages = useAppStore(s => s.messages[chatKey]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatInited, setChatInited] = useState(false);
  const locked = useAppStore(s => !!s.busyChatKeys[chatKey]);

  const chatKeyChanged = chatKey !== previousChatKey;

  if (chatKeyChanged) {
    setChatInited(false);
    setStreaming(false);
    setInput('');
    setPreviousChatKey(chatKey);
  }

  useInitChat(chatKey, chatKeyChanged, setChatInited);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useScroll(agentMessages, scrollRef);

  const { handleSend, handleKeyDown } = useSend(
    chatKey, agent, projectId, input, setInput, streaming, setStreaming
  );

  useSSEConnection(chatInited, chatKey);

  if (agent.fired) {
    return <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">{t('web.pages.chat.noAgent.title')}</h2>
        <p className="text-sm text-center">{t('web.pages.chat.noAgent.description')}</p>
    </div>
  }

  return (
    <div className="flex flex-col h-full bg-white min-h-140">
      {<ChatHeader agent={agent} />}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {!agentMessages?.length ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm mt-1">{t(`web.pages.chat.type.${!projectId ? 'agent' : 'project'}.emptyPrompt`, {name: agent.name})}</p>
          </div>
        ) : (
          agentMessages.map((message, i) => (
            <div
              key={message.id}
              className={`flex ${messageFlexStyles[message.type]}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    messageTextStyles[message.type]
                }`}
                >
                {(message.type === 'user' || (i === agentMessages.length - 1 && streaming)) && 
                    <p className="text-sm whitespace-pre-wrap">
                        {message.content || t('web.pages.chat.loading')}
                    </p>}
                {message.type === 'agent' && !(i === agentMessages.length - 1 && streaming) &&
                    <Markdown content={message.content || t('web.pages.chat.loading')} />}
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
            disabled={streaming || locked}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={locked && !streaming
              ? t('web.pages.chat.busy', { name: agent.name })
              : t('web.pages.chat.send', { name: agent.name })}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg disabled:bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!chatInited || streaming || locked}
            className={`px-4 py-2 bg-blue-500 text-white rounded-lg
              ${streaming || locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
              transition-colors flex items-center gap-2`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
