'use client';

import type { Project, Task } from '@deepclaw/loop-gateway';
import type { AgentEmployee } from '@deepclaw/core';
import {
  Users,
} from 'lucide-react';
import { AgentHeader } from './AgentDetailHeader';
import { AgentDetailPersonality } from './AgentDetailPersonality';
import { AgentDetailSkills } from './AgentDetailSkills';
import { AgentDetailWorkStatus } from './AgentDetailWorkStatus';
import { useTranslation } from 'react-i18next';

export function AgentDetail({agent, projects}: {agent?: AgentEmployee, projects: Project<Task>[]}) {
  const {t} = useTranslation();

  if (!agent) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50">
        <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-6">
          <Users size={48} className="text-gray-300" />
        </div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('pages.agents.noSelection.title')}</h2>
        <p className="text-sm text-gray-500 text-center max-w-xs">
          {t('pages.agents.noSelection.description')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-4 space-y-4 sm:space-y-6">
        {/* Header */}
        <AgentHeader agent={agent} />

        {/* Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <AgentDetailPersonality agent={agent} />
          <AgentDetailSkills agent={agent} />
        </div>

        {/* Work Style */}
        <AgentDetailWorkStatus projects={projects} agent={agent} />
      </div>
    </div>
  );
}
