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
import type { SSEConnectedEvent, SSELoopStreamEvent, SSELoopBusyEvent } from '@/app/api/sse-server';
import { Markdown } from "./Markdown";
import { useSSEClient } from '@/components/layout/SSEProvider';

type ChatPanelProps = {
  agent: AgentEmployee;
  projectId: string;
};

const logger = getLogger('ChatPanel');

function loopSse(loopId: string): { key: string; url: string } {
  const params = new URLSearchParams({ loopId });
  return { key: `loop:${loopId}`, url: `/api/loop?${params.toString()}` };
}

export function ChatPanel({ agent, projectId }: ChatPanelProps) {
  const chatKey = getChatKey(agent.id, projectId);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [previousChatKey, setPreviousChatKey] = useState(chatKey);
  const addMessage = useAppStore(s => s.addMessage);
  const updateMessageStreamByChatKey = useAppStore(s => s.updateMessageStreamByChatKey);
  const setChatBusy = useAppStore(s => s.setChatBusy);
  const locked = useAppStore(s => !!s.busyChatKeys[chatKey]);
  const agentMessages = useAppStore(s => s.messages[chatKey]);
  const sseClient = useSSEClient();
  const { t, i18n } = useTranslation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  if (chatKey !== previousChatKey) {
    setStreaming(false);
    setInput('');
    setPreviousChatKey(chatKey);
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
  }, [chatKey]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || locked) return;

    const loopId = chatKey;
    const { key: sseKey, url: sseUrl } = loopSse(loopId);

    setInput('');
    setStreaming(true);
    setChatBusy(loopId, true);
    addMessage('user', agent.id, projectId, trimmed);
    addMessage('agent', agent.id, projectId, '');
    const unsubscribeMessageStream = sseClient.subscribePersistent<Extract<SSELoopStreamEvent, {sseType: 'streamText'}>>(
      sseKey,
      sseUrl,
      'streamText',
      ({loopId, content, done}) => {
        if (!done) {
          updateMessageStreamByChatKey(loopId, content);
        }
      },
      {
        listenerKey: 'streamText:message',
        removeOn: ({done}) => done,
      },
    );
    try {
      const result = await invoke(agent.id, projectId, trimmed);
      if (result.status !== 'ok') {
        unsubscribeMessageStream();
        const text = result.status === 'busy'
          ? t('pages.chat.busy', { name: agent.name })
          : t('pages.chat.invoke.error');
        updateMessageStreamByChatKey(loopId, `\n${text}`);
        setStreaming(false);
        setChatBusy(loopId, result.status === 'busy');
      }
    } catch {
      unsubscribeMessageStream();
      updateMessageStreamByChatKey(loopId, `\n${t('pages.chat.invoke.error')}`);
      setStreaming(false);
      setChatBusy(loopId, false);
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
    const loopId = chatKey;
    const { key: sseKey, url: sseUrl } = loopSse(loopId);

    const unsubscribers = [
      sseClient.subscribe<Extract<SSEConnectedEvent, {sseType: 'connected'}>>(
        sseKey,
        sseUrl,
        'connected',
        ({content}) => {
          logger.info(`Connected for ${content}.`);
        },
      ),
      sseClient.subscribe<Extract<SSELoopStreamEvent, {sseType: 'streamText'}>>(
        sseKey,
        sseUrl,
        'streamText',
        ({done}) => {
          if (done) {
            setStreaming(false);
          }
        },
      ),
      sseClient.subscribe<Extract<SSELoopBusyEvent, {sseType: 'loopBusy'}>>(
        sseKey,
        sseUrl,
        'loopBusy',
        ({loopId, busy}) => {
          setChatBusy(loopId, busy);
        },
      ),
    ];

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [sseClient, setChatBusy, chatKey]);

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
                    <Markdown content={message.content || t('pages.chat.loading')} />}
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
              ? t('pages.chat.busy', { name: agent.name })
              : t('pages.chat.send', { name: agent.name })}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg disabled:bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={streaming || locked}
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
