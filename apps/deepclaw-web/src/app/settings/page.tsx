import {
    DeepclawConfig, APP_CONFIG_EVENTS, MAX_AGENT_COUNT, MAX_COMPANY_PROFILE_LENGTH
} from '@deepclaw/config';
import SettingsPage from '@/components/settings/SettingsPage';
import { loadCurrentConfig, saveFullConfig, validateConfig } from '@/server/configs';
import { clone } from '@deepclaw/utils';

const clonedAppEvents = clone(APP_CONFIG_EVENTS, (k, v) => {
    return k === 'content' || k === 'label' ? `web.${v}` : v;
});

// This page hands the settings of whoever asks for it to the browser. Rendered ahead of time it
// would hand out the settings of whoever built it, keys and all, to everyone who installs it.
export const dynamic = 'force-dynamic';

export default async function Settings() {
    const config: DeepclawConfig = await loadCurrentConfig();
    const initialValidation = await validateConfig(config);
    return (
        <SettingsPage
            settings={{
                // The limits are handed over rather than imported by the form: the package they
                // are declared in reads the config off the disk as it loads, which is nothing to
                // pull into a browser bundle.
                metaData: {
                    maxAgentCount: MAX_AGENT_COUNT,
                    maxCompanyProfileLength: MAX_COMPANY_PROFILE_LENGTH,
                },
                configEvents: clonedAppEvents,
                initialConfig: config,
                initialValidation: initialValidation,
                onSave: saveFullConfig
            }}
        />
    );
}
