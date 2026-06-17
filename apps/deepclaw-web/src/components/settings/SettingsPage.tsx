'use client';

import { SettingsForm, type SettingsProps } from '@/components/settings/SettingsForm';
import { type DeepclawConfig } from '@deepclaw/config';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { AgentEmployee } from '@deepclaw/core';

export default function SettingsPage({
    settings
}: {
    settings: Omit<SettingsProps, 'onSave'>
      & {onSave: (config: DeepclawConfig) => Promise<AgentEmployee[]>};
}) {
  const {i18n} = useTranslation();
  const {agents, setAgents, updateAgentEmployee} = useAppStore();

  const handleSave = (newConfig: DeepclawConfig) => {
    const oldLang = i18n.language;

    settings.onSave(newConfig).then((newAgents) => {
        if (oldLang !== newConfig.ui.lang) {
          i18n.changeLanguage(newConfig.ui.lang);
        }
        setAgents([...agents, ...newAgents]);
        newConfig.agents.filter(agent => !newAgents.find(a => a.id === agent.id)).forEach(agent => {
            updateAgentEmployee(agent.id, { name: agent.name, fired: !!agent.fired });
        });
    }).catch(() => {
        // TODO handle fallback
    });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 lg:p-8">
        <SettingsForm
            settings={{...settings, onSave: handleSave}}
        />
      </div>
    </div>
  );
}
