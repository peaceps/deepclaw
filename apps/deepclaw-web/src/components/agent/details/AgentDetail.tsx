'use client';

import type { AgentEmployee, AgentSoulIdentity } from '@deepclaw/core';
import {
  Users
} from 'lucide-react';
import { AgentHeader } from './AgentDetailHeader';
import { AgentDetailPersonality } from './AgentDetailPersonality';
import { AgentDetailExpertise } from './AgentDetailExpertise';
import { AgentDetailWorkStatus } from './AgentDetailWorkStatus';
import { useTranslation } from 'react-i18next';
import { AgentDetailDescription } from './AgentDetailDescription';
import { useCallback } from 'react';
import { updateAgentIdentity } from "@/server/data";
import { useAppStore } from '@/lib/store';
import { UpdateContent } from '@deepclaw/utils';

export function AgentDetail({agent}: {
    agent?: AgentEmployee;
}) {
  const {t} = useTranslation();
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);

  const onAgentUpdate = useCallback((patch: UpdateContent<AgentSoulIdentity>) => {
    updateAgentEmployee(patch);
    updateAgentIdentity(patch).catch(() => {
        // TODO handle fallback
    });
  }, [updateAgentEmployee]);

  if (!agent) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50">
        <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6">
          <Users size={48} className="text-gray-300" />
        </div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('web.pages.agents.noSelection.title')}</h2>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          {t('web.pages.agents.noSelection.description')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 min-w-0">
      <div key={agent.id} className="p-4 space-y-4 sm:space-y-6">
        {/* Header */}
        <AgentHeader agent={agent} onUpdate={onAgentUpdate} />

        {/* Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <AgentDetailPersonality agent={agent} onUpdate={onAgentUpdate} />
          <AgentDetailExpertise agent={agent} onUpdate={onAgentUpdate} />
        </div>

        <AgentDetailDescription
          agent={agent}
          onUpdate={onAgentUpdate}
        />

        {/* Work Style */}
        <AgentDetailWorkStatus agent={agent} />
      </div>
    </div>
  );
}
