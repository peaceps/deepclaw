import { DeepclawConfig } from '@deepclaw/gateway';
import SettingsPage from '@/components/settings/SettingsPage';
import { loadCurrentConfig, saveConfig, validateConfig } from '@/server/configs';

export default async function Settings() {
    const config: DeepclawConfig = await loadCurrentConfig();
    const initialValidation = await validateConfig(config);
    return (
        <SettingsPage initialConfig={config} initialValidation={initialValidation} onSave={saveConfig} />
    );
}
