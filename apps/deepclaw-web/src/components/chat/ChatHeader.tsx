'use client';

import { AgentEmployee, TokenUsage } from "@deepclaw/core";
import { History, SquarePen } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { avatarBG, statusColors } from '../styles-mapping';
import { deriveAgentSummary, useAgentActivity, useAppStore } from "@/lib/store";
import { TokenUsageIcon } from "@/laf/token-usage";
import { ConfirmModal } from "@/laf/confirm-modal";
import { SessionHistoryMenu } from "./SessionHistoryMenu";

type ChatHeaderProps = {
  agent: AgentEmployee;
  tokenUsage?: TokenUsage;
  /**
   * The chat this header belongs to lets conversations be closed and read back. Off everywhere else:
   * the same header hangs over a project chat and over a card on the board, and neither of those is
   * a place to start the agent over from.
   */
  sessionActions?: boolean;
  loopId?: string;
  viewingSessionId?: string | null;
  startingSession?: boolean;
  onNewSession?: () => void;
  onViewSession?: (sessionId: string | null) => void;
};

export function ChatHeader({
  agent, tokenUsage, sessionActions = false, loopId = '',
  viewingSessionId = null, startingSession = false, onNewSession, onViewSession,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const projects = useAppStore(s => s.projects);
  const { status: agentStatus } = deriveAgentSummary(agent, projects, useAgentActivity());
  const locked = useAppStore(s => !!s.busyChatKeys[loopId]);
  const historyRef = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A conversation cannot be closed out from under a run: what it was writing would be cut in half,
  // and the folder it was writing into is the one being moved aside.
  const canStartNew = !locked && !viewingSessionId && !startingSession;

  return (
    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-full ${avatarBG} flex items-center justify-center text-xl`}>
        {agent.avatar}
      </div>
      <div className="grow-1">
        <div className={`w-2 h-2 mr-2 pt-1 rounded-full inline-block ${statusColors[agentStatus]}`} />
        <h3 className="font-semibold text-gray-900 inline-block">{agent.name}</h3>
        <p className="text-xs text-gray-500">{agent.role}</p>
      </div>
      <TokenUsageIcon tokenUsage={tokenUsage} />
      {sessionActions && (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canStartNew}
            title={t(`web.pages.chat.session.${locked ? 'busyHint' : 'new'}`)}
            className={`text-gray-400 transition-colors disabled:opacity-30
              ${canStartNew ? 'hover:text-gray-600 cursor-pointer' : 'cursor-not-allowed'}`}
          >
            <SquarePen size={18} />
          </button>
          <button
            ref={historyRef}
            type="button"
            onClick={() => setHistoryOpen(open => !open)}
            title={t('web.pages.chat.session.history')}
            className="text-gray-400 transition-colors hover:text-gray-600 cursor-pointer"
          >
            <History size={18} />
          </button>
        </>
      )}
      {historyOpen && (
        <SessionHistoryMenu
          loopId={loopId}
          viewingSessionId={viewingSessionId}
          anchorRef={historyRef}
          onPick={(sessionId) => {
            setHistoryOpen(false);
            onViewSession?.(sessionId);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {confirming && (
        <ConfirmModal
          title={t('web.pages.chat.session.new')}
          message={t('web.pages.chat.session.newConfirm', {name: agent.name})}
          confirmLabel={t('web.pages.chat.session.newConfirmAction')}
          onConfirm={() => {
            setConfirming(false);
            onNewSession?.();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
