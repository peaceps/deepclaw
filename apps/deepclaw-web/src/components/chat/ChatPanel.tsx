'use client';

import { AgentEmployee, getLoopId, TokenUsage, type ImageContent } from "@deepclaw/core";
import { Send, ImagePlus, X, ArrowLeft, Square } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore } from '@/lib/store';
import { useToastStore } from '@/lib/toast-store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';
import { formatDate, imageSrc } from '../component-utils';
import { Markdown } from "@/laf/markdown";
import {
  useInitChat, useSSEConnection, useSend, useLoopWatch, useArchivedChat, useNewSession,
  useStopLoop, archivedChatKey
} from "./use-chat-hooks";
import { useScroll } from "./use-scroll-hooks";

type ChatPanelProps = {
  agent: AgentEmployee;
  projectId: string;
  /**
   * Fit exactly into the parent container instead of enforcing the 560px
   * minimum height. Use when the parent has a definite height and
   * overflow-hidden (e.g. the mobile agent page), where a fixed minimum
   * height would push the input row out of the visible area.
   */
  fitContainer?: boolean;
  /** Whether this chat may close its conversation and read the ones that were closed. */
  sessionActions?: boolean;
};

// as many as an image model takes as the pictures to draw from
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** How tall the box may grow before it scrolls instead, leaving the conversation room to be read. */
const MAX_INPUT_HEIGHT = 160;

function fileToImageContent(file: File): Promise<ImageContent> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            url: reader.result as string,
            mediaType: file.type,
        });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function ChatPanel({
  agent, projectId, fitContainer = false, sessionActions = false
}: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const role = !projectId ? 'agent' : 'project';
  const loopId = getLoopId(role, agent.id, projectId);
  const liveMessages = useAppStore(s => s.messages[loopId]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageContent[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>(undefined);
  const [chatInited, setChatInited] = useState(false);
  const [listening, setListening] = useState(false);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const locked = useAppStore(s => !!s.busyChatKeys[loopId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const showToast = useToastStore(s => s.show);

  // The box starts one line tall and grows with what is written into it: a message of several
  // lines is written in front of the user rather than through a slot one line wide. Measured off
  // what is in it, so it shrinks back as lines are deleted and again when a send empties it.
  //
  // Before the paint rather than after, since a height is what is being measured: the draft a
  // reopened panel restores would otherwise be drawn one line tall and jump to its own height.
  // Which is also why the session read is a dependency and not only the text -- reading a closed
  // conversation takes the whole input area off the screen, and the box that comes back is a new
  // element with no height on it while the draft in it never changed.
  useLayoutEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = 'auto';
    // scrollHeight stops at the padding, and a height set on a border-box element has to cover the
    // border too, or every line sits two pixels short of the room it needs and the box scrolls.
    const border = box.offsetHeight - box.clientHeight;
    box.style.height = `${Math.min(box.scrollHeight + border, MAX_INPUT_HEIGHT)}px`;
  }, [input, viewingSessionId]);

  // The live chat is kept listening while one that was closed is read, so that going back to it
  // shows what the agent said in the meantime rather than a transcript that stopped.
  useInitChat(loopId, setChatInited, setInput, setTokenUsage);
  useSSEConnection(chatInited, loopId, setListening, setTokenUsage);
  useLoopWatch(listening, loopId);
  const archived = useArchivedChat(loopId, viewingSessionId);
  const { startNew, starting } = useNewSession(loopId);
  const { stop, stopping } = useStopLoop(loopId, locked);

  const agentMessages = !viewingSessionId ? liveMessages : archived.messages;
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useScroll(
    agentMessages,
    scrollRef,
    !viewingSessionId ? loopId : archivedChatKey(loopId, viewingSessionId),
    !viewingSessionId ? undefined : archived.pullOlder,
  );

  const { handleSend, handleKeyDown } = useSend(
    loopId, role, agent, projectId, chatInited, input, setInput,
    pendingImages, () => setPendingImages([])
  );

  const handleImageSelect = async (files: FileList | null) => {
    if (!files) return;
    const images: ImageContent[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > MAX_IMAGE_BYTES) {
        showToast({type: 'warning', message: t('web.pages.chat.image.tooLarge', {
          name: file.name, size: MAX_IMAGE_BYTES / 1024 / 1024
        })});
        continue;
      }
      images.push(await fileToImageContent(file));
    }
    // the warning belongs out here: react runs an updater while rendering, and more than once
    if (pendingImages.length + images.length > MAX_IMAGES) {
      showToast({type: 'warning', message: t('web.pages.chat.image.tooMany', {count: MAX_IMAGES})});
    }
    setPendingImages(prev => [...prev, ...images].slice(0, MAX_IMAGES));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canAddImage = chatInited && !locked && pendingImages.length < MAX_IMAGES;
  const reading = !!viewingSessionId;
  // The last message of a run being written is shown as plain text until it is whole. The last of a
  // conversation that was closed was written long ago, whatever the loop happens to be doing now.
  const writing = locked && !reading;

  const removePendingImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  if (agent.fired) {
    return <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">{t('web.pages.chat.noAgent.title')}</h2>
        <p className="text-sm text-center">{t('web.pages.chat.noAgent.description')}</p>
    </div>
  }

  return (
    <div className={`flex flex-col h-full bg-white ${fitContainer ? '' : 'min-h-140'}`}>
      <ChatHeader
        agent={agent}
        tokenUsage={reading ? undefined : tokenUsage}
        sessionActions={sessionActions}
        loopId={loopId}
        viewingSessionId={viewingSessionId}
        startingSession={starting}
        onNewSession={startNew}
        onViewSession={setViewingSessionId}
      />
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {!agentMessages?.length ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm mt-1">{t(
              reading ? 'web.pages.chat.session.emptyRead'
                : `web.pages.chat.type.${!projectId ? 'agent' : 'project'}.emptyPrompt`,
              {name: agent.name}
            )}</p>
          </div>
        ) : (
          agentMessages.map((message, i) => (
            <div
              key={message.id}
              className={`flex ${messageFlexStyles[message.type]}`}
            >
              <div
                className={`max-w-[80%] min-w-0 rounded-2xl px-4 py-3 ${
                    messageTextStyles[message.type]
                }`}
                >
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {message.images.map((img, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element -- imageSrc yields data: and arbitrary remote URLs, which next/image cannot optimize
                      <img
                        key={idx}
                        src={imageSrc(img.url)}
                        alt={`image-${idx}`}
                        className="max-w-48 max-h-48 rounded-lg object-cover"
                      />
                    ))}
                  </div>
                )}
                {/* cursor-auto for the same reason the Markdown below asks for it: these two
                    carry what was said, before it is settled enough to render. A message with
                    nothing in it yet is one of them: the word for waiting is not an answer, and
                    rendered as one it would be offered to be copied. */}
                {message.type === 'user' && !!message.content &&
                    <p className="text-sm whitespace-pre-wrap wrap-anywhere cursor-auto">{message.content}</p>}
                {message.type === 'agent'
                        && (!message.content || (i === agentMessages.length - 1 && writing)) &&
                    <p className="text-sm whitespace-pre-wrap wrap-anywhere cursor-auto">
                        {message.content || t('web.pages.chat.loading')}
                    </p>}
                {message.type === 'agent' && !!message.content
                        && !(i === agentMessages.length - 1 && writing) &&
                    <Markdown content={message.content} />}
                <p className={`text-xs mt-1 ${messageTimeStyles[message.type]}`}>
                  {formatDate(i18n.language, message.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {reading && (
        <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <p className="flex-1 text-xs text-gray-500">{t('web.pages.chat.session.readonly')}</p>
          <button
            type="button"
            onClick={() => setViewingSessionId(null)}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs
              font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={14} />
            {t('web.pages.chat.session.backToCurrent')}
          </button>
        </div>
      )}
      {!reading && pendingImages.length > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-2">
          {pendingImages.map((img, idx) => (
            <div key={idx} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element -- the preview src is a data: URL from FileReader, which next/image cannot optimize */}
              <img
                src={img.url}
                alt={`pending-${idx}`}
                className="w-16 h-16 rounded-lg object-cover border border-gray-200"
              />
              <button
                onClick={() => removePendingImage(idx)}
                className="absolute -top-1 -right-1 bg-gray-600 text-white rounded-full w-5 h-5
                  flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {!reading && <div className="p-4 border-t border-gray-100">
        {/* Aligned to the bottom: the box is the only thing here that grows, and the buttons stay
            where the hand left them rather than riding up the side of it. */}
        <div className="flex gap-2 items-end">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageSelect(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!canAddImage}
            className={`px-3 py-2 text-gray-400 disabled:opacity-30 transition-colors flex items-center
              ${canAddImage ? 'hover:text-gray-600' : 'cursor-not-allowed'}`}
            title={t('web.pages.chat.image.upload')}
          >
            <ImagePlus size={20} />
          </button>
          {/* Dead until the messages already said have arrived, as the two buttons beside it are:
              what is sent into a chat that has not read itself yet lands above its own history. */}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            disabled={locked || !chatInited}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('web.pages.chat.send', { name: agent.name })}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg disabled:bg-gray-50
              resize-none overflow-y-auto leading-6
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {/* While a run is on, the one thing this button is good for is ending it. */}
          {locked ? (
            <button
              onClick={stop}
              disabled={stopping}
              title={t(stopping ? 'web.pages.chat.stop.stopping' : 'web.pages.chat.stop.title')}
              className={`px-4 py-2 bg-white text-red-500 border border-red-200 rounded-lg
                ${stopping ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-50'}
                transition-colors flex items-center gap-2`}
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!chatInited}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600
                transition-colors flex items-center gap-2"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>}
    </div>
  );
}
