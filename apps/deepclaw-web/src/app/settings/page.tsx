import { DeepclawConfig, APP_CONFIG_EVENTS, MAX_AGENT_COUNT } from '@deepclaw/config';
import SettingsPage from '@/components/settings/SettingsPage';
import { loadCurrentConfig, saveFullConfig, validateConfig } from '@/server/configs';
import { clone } from '@deepclaw/utils';

const clonedAppEvents = clone(APP_CONFIG_EVENTS, (k, v) => {
    return k === 'content' || k === 'label' ? `web.${v}` : v;
});

export default async function Settings() {
    const config: DeepclawConfig = await loadCurrentConfig();
    const initialValidation = await validateConfig(config);
    return (
        <SettingsPage
            settings={{
                metaData: {maxAgentCount: MAX_AGENT_COUNT},
                configEvents: clonedAppEvents,
                initialConfig: config,
                initialValidation: initialValidation,
                onSave: saveFullConfig
            }}
        />
    );
}
