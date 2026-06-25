'use client';

import { AgentEmployee } from "@deepclaw/core";
import { Send } from 'lucide-react';
import { invoke } from '@/server/loop-agent';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore, getChatKey } from '@/lib/store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';
import { formatDate } from '../component-utils';
import { getLogger } from "@/lib/logger";
import type { SSEConnectedEvent, SSELoopStreamEvent } from '@/app/api/sse-server';
import { Markdown } from "./Markdown";

type ChatPanelProps = {
  agent: AgentEmployee;
  projectId: string;
};

const logger = getLogger('ChatPanel');

export function ChatPanel({ agent, projectId }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [previousAgent, setPreviousAgent] = useState(agent.id);
  const addMessage = useAppStore(s => s.addMessage);
  const updateMessageStream = useAppStore(s => s.updateMessageStream);
  const agentMessages = useAppStore(s => s.messages[getChatKey(agent.id, projectId)]);
  const { t, i18n } = useTranslation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  if (agent.id !== previousAgent) {
    setStreaming(false);
    setInput('');
    setPreviousAgent(agent.id);
  }

  const lastContent = agentMessages?.[agentMessages.length - 1]?.content ?? '';
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [agentMessages?.length, lastContent]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [agent.id]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    setStreaming(true);
    addMessage('user', agent.id, projectId, trimmed);
    addMessage('agent', agent.id, projectId, '');
    try {
      await invoke(agent.id, projectId, trimmed);
    } catch (e: any) {
      updateMessageStream(agent.id, projectId, `\n${e?.message?.toString() || t('pages.chat.invoke.error')}`);
      setStreaming(false);
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
    const params = new URLSearchParams({
        loopId: getChatKey(agent.id, projectId),
    });
    const eventSource = new EventSource(`/api/loop?${params.toString()}`);

    const connectedListener = (event: MessageEvent<string>) => {
      const {clientId} = JSON.parse(event.data) as Extract<SSEConnectedEvent, {sseType: 'connected'}>;
      logger.info(`Connected for ${clientId}.`);
    };
    const streamTextListener = (event: MessageEvent<string>) => {
      const {content, done} = JSON.parse(event.data) as Extract<SSELoopStreamEvent, {sseType: 'streamText'}>;
      if (done) {
          setStreaming(false);
        } else {
          updateMessageStream(agent.id, projectId, content);
      }
    };

    eventSource.addEventListener('connected', connectedListener);
    eventSource.addEventListener('streamText', streamTextListener);

    return () => {
        eventSource.removeEventListener('connected', connectedListener);
        eventSource.removeEventListener('streamText', streamTextListener);
        eventSource.close();
    };
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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {!agentMessages?.length ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm mt-1">{t(`pages.chat.type.${!projectId ? 'agent' : 'project'}.emptyPrompt`, {name: agent.name})}</p>
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
                        {message.content || t('pages.chat.loading')}
                    </p>}
                {message.type === 'agent' && !(i === agentMessages.length - 1 && streaming) &&
                    <Markdown content={message.content || t('pages.chat.emptyLLMOutput')} />}
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
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('pages.chat.send', { name: agent.name })}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={streaming}
            className={`px-4 py-2 bg-blue-500 text-white rounded-lg
              ${streaming ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
              transition-colors flex items-center gap-2`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
