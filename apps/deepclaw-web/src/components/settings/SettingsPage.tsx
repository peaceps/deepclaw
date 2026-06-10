'use client';

import { SettingsForm } from '@/components/settings/SettingsForm';
import { type DeepclawConfig } from '@deepclaw/config';
import { useTranslation } from 'react-i18next';

export default function SettingsPage({ initialConfig, initialValidation, onSave }: any) {
  const {i18n} = useTranslation();

  const handleSave = (newConfig: DeepclawConfig) => {
    const oldLang = i18n.language;
    if (oldLang !== newConfig.ui.lang) {
      i18n.changeLanguage(newConfig.ui.lang);
    }
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
