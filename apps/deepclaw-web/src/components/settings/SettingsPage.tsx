'use client';

import { SettingsForm } from '@/components/settings/SettingsForm';
import { type DeepclawConfig } from '@deepclaw/gateway';

export default function SettingsPage({ initialConfig, initialValidation, onSave }: any) {

  const handleSave = (newConfig: DeepclawConfig) => {
    onSave(newConfig);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 lg:p-8">
        <SettingsForm initialConfig={initialConfig} initialValidation={initialValidation} onSave={handleSave} />
      </div>
    </div>
  );
}
