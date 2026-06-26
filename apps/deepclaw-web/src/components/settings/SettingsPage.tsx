'use client';

import { SettingsForm, type SettingsProps } from '@/components/settings/SettingsForm';
import { type DeepclawConfig } from '@deepclaw/config';
import { useTranslation } from 'react-i18next';

export default function SettingsPage({
    settings
}: {
    settings: Omit<SettingsProps, 'onSave'>
      & {onSave: (config: DeepclawConfig) => Promise<void>};
}) {
  const {i18n} = useTranslation();

  const handleSave = (newConfig: DeepclawConfig): Promise<void> => {
    const oldLang = i18n.language;

    return settings.onSave(newConfig).then(() => {
        if (oldLang !== newConfig.ui.lang) {
          i18n.changeLanguage(newConfig.ui.lang);
        }
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
