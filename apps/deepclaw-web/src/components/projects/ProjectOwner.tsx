'use client';

import type { AgentEmployee } from '@deepclaw/core';
import { User } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskOwnerTooltip } from './TaskOwnerTooltip';

type ProjectOwnerProps = {
  ownerAgent?: AgentEmployee;
  fallbackName: string;
  onInteract?: () => void;
};

export function ProjectOwner({ ownerAgent, fallbackName, onInteract }: ProjectOwnerProps) {
  const {t} = useTranslation();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const ownerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (!ownerAgent) {
      return;
    }
    event.stopPropagation();
    onInteract?.();
    setTooltipVisible(true);
  }, [onInteract, ownerAgent]);

  return (
    <>
      <div
        ref={ownerRef}
        onClick={handleClick}
        className={`flex items-center gap-1.5 text-sm bg-purple-50 px-2 py-1
            rounded-lg transition-colors ${
          ownerAgent ? 'cursor-pointer hover:bg-purple-100 max-sm:pointer-events-none' : ''
        }`}
      >
        <User size={16} className="text-violet-500" />
        <span className="text-gray-500">{t('web.pages.projects.project.owner')}:</span>
        <span className="font-medium text-violet-500">{ownerAgent?.name ?? fallbackName}</span>
      </div>
      {ownerAgent && <TaskOwnerTooltip
        agent={ownerAgent}
        visible={tooltipVisible}
        anchorRef={ownerRef}
        onClose={() => setTooltipVisible(false)}
      />}
    </>
  );
}
