'use client';

import { SettingsForm } from '@/components/settings/SettingsForm';
import { loadConfig, saveConfig, DeepclawConfig } from '@/lib/config';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [config, setConfig] = useState<DeepclawConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {

    setTimeout(() => {
      const loadedConfig = loadConfig();
      setConfig(loadedConfig);
      setIsLoading(false);
    });
  }, []);

  const handleSave = (newConfig: DeepclawConfig) => {
    saveConfig(newConfig);
    setConfig(newConfig);
    
    console.log('========== DeepClaw 设置已保存 ==========');
    console.log('配置内容:', JSON.stringify(newConfig, null, 2));
    console.log('========================================');
  };

  if (isLoading || !config) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 lg:p-8">
        <SettingsForm initialConfig={config} onSave={handleSave} />
      </div>
    </div>
  );
}
