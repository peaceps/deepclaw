'use client';

import { AgentEmployee, getLoopId, TokenUsage, type ImageContent } from "@deepclaw/core";
import { Send, ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeader } from './ChatHeader';
import { useAppStore } from '@/lib/store';
import { useToastStore } from '@/lib/toast-store';
import { messageFlexStyles, messageTextStyles, messageTimeStyles } from '../styles-mapping';
import { formatDate, imageSrc } from '../component-utils';
import { Markdown } from "@/laf/markdown";
import { useInitChat, useSSEConnection, useSend, useLoopWatch } from "./use-chat-hooks";
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
};

// as many as an image model takes as the pictures to draw from
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export function ChatPanel({ agent, projectId, fitContainer = false }: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const role = !projectId ? 'agent' : 'project';
  const loopId = getLoopId(role, agent.id, projectId);
  const agentMessages = useAppStore(s => s.messages[loopId]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ImageContent[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | undefined>(undefined);
  const [chatInited, setChatInited] = useState(false);
  const [listening, setListening] = useState(false);
  const locked = useAppStore(s => !!s.busyChatKeys[loopId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToastStore(s => s.show);

  useInitChat(loopId, setChatInited, setInput, setTokenUsage);
  useSSEConnection(chatInited, loopId, setListening, setTokenUsage);
  useLoopWatch(listening, loopId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useScroll(agentMessages, scrollRef, loopId);

  const { handleSend, handleKeyDown } = useSend(
    loopId, role, agent, projectId, input, setInput, pendingImages, () => setPendingImages([])
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
      {<ChatHeader agent={agent} tokenUsage={tokenUsage}/>}
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
                {message.type === 'user' && !!message.content &&
                    <p className="text-sm whitespace-pre-wrap wrap-anywhere">{message.content}</p>}
                {message.type === 'agent' && (i === agentMessages.length - 1 && locked) &&
                    <p className="text-sm whitespace-pre-wrap wrap-anywhere">
                        {message.content || t('web.pages.chat.loading')}
                    </p>}
                {message.type === 'agent' && !(i === agentMessages.length - 1 && locked) &&
                    <Markdown content={message.content || t('web.pages.chat.loading')} />}
                <p className={`text-xs mt-1 ${messageTimeStyles[message.type]}`}>
                  {formatDate(i18n.language, message.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {pendingImages.length > 0 && (
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
      <div className="p-4 border-t border-gray-100">
        <div className="flex gap-2">
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
          <input
            type="text"
            value={input}
            disabled={locked}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('web.pages.chat.send', { name: agent.name })}
            className="flex-1 px-4 py-2 border border-gray-200 rounded-lg disabled:bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!chatInited || locked}
            className={`px-4 py-2 bg-blue-500 text-white rounded-lg
              ${locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
              transition-colors flex items-center gap-2`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
