import { DeepclawConfig, APP_CONFIG_EVENTS } from '@deepclaw/config';
import SettingsPage from '@/components/settings/SettingsPage';
import { loadCurrentConfig, saveFullConfig, validateConfig } from '@/server/configs';

export default async function Settings() {
    const config: DeepclawConfig = await loadCurrentConfig();
    const initialValidation = await validateConfig(config);
    return (
        <SettingsPage
            settings={{
                configEvents: APP_CONFIG_EVENTS,
                initialConfig: config,
                initialValidation: initialValidation,
                onSave: saveFullConfig
            }}
        />
    );
}
