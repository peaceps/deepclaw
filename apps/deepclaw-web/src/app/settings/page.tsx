import { DeepclawConfig } from '@deepclaw/gateway';
import SettingsPage from '@/components/settings/SettingsPage';
import { loadCurrentConfig, saveConfig } from '@/server/configs';

export default async function Settings() {
    const config: DeepclawConfig = await loadCurrentConfig();
    return (
        <SettingsPage initialConfig={config} onSave={saveConfig} />
    );
}
