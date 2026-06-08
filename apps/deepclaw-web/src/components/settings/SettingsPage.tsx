'use client';

import { SettingsForm } from '@/components/settings/SettingsForm';
import { type DeepclawConfig } from '@deepclaw/gateway';

export default function SettingsPage({ initialConfig, onSave }: any) {

  const handleSave = (newConfig: DeepclawConfig) => {
    onSave(newConfig);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 lg:p-8">
        <SettingsForm initialConfig={initialConfig} onSave={handleSave} />
      </div>
    </div>
  );
}
