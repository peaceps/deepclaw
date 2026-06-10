import {AgentInteractionEvent} from "@deepclaw/core";
import {DeepclawConfig, MissingAppConfig, validateCurrentAppConfig, writeAppConfig} from "./app-config";
import {APP_CONFIG_EVENTS} from './app-config-events';
import { FileUtils } from "@deepclaw/utils";

export async function validateAndFixCurrentConfig(
    handleAgentEvent: (event: AgentInteractionEvent) => Promise<string|boolean|number>,
    headless: boolean = false,
) {
    const appConfig = validateCurrentAppConfig(headless);
    if (appConfig.lacks.length > 0) {
        await handleAgentEvent(APP_CONFIG_EVENTS['hint']!);
        const agentsIndex = appConfig.lacks.indexOf('agents');
        if (agentsIndex !== -1) {
            const agent = {standaloneTask: 'transient', llm: {}} as DeepclawConfig['agents'][0];
            const missing = ['name', 'mode', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model'];
            if (headless) {
                agent.im = {} as DeepclawConfig['agents'][0]['im'];
                missing.push('im.engine', 'im.appId', 'im.secret');
            }
            appConfig.config.agents = [agent];
            appConfig.lacks.splice(agentsIndex, 1, { agents: { 0: missing } });
        }
        await ensureAppConfig(headless, appConfig, handleAgentEvent);
    }
    ensureBasicFiles();
}

async function ensureAppConfig(
    headless: boolean,
    {config, lacks}: {config: DeepclawConfig, lacks: MissingAppConfig},
    handleAgentEvent: (event: AgentInteractionEvent) => Promise<string|boolean|number>,
) {
    for (const lack of lacks) {
        if (typeof lack === 'string') {
            const event = APP_CONFIG_EVENTS[lack]!;
            const answer = await handleAgentEvent(event);
            setConfigValue(config, lack, answer);
        } else {
            for (const key of Object.keys(lack)) {
                const subArrayConfig = config[key as keyof DeepclawConfig] as any[];
                for (const index of Object.keys(lack[key as keyof DeepclawConfig]!)) {
                    const subConfig = subArrayConfig[index as unknown as number];
                    const subLacks = lack[key as keyof DeepclawConfig]![Number(index)]!;
                    const name = 'name' in subConfig ? subConfig['name'] : (Number(index) + 1).toString();
                    await handleAgentEvent({...APP_CONFIG_EVENTS[`${key}.index`]!, i18nParam: {name}});
                    if (key === 'agents' && !headless && !subConfig.im) {
                        subLacks.push('headlessEnabled');
                    }

                    for (const subLack of subLacks) {
                        const event = APP_CONFIG_EVENTS[`${key}.${subLack}`]!;
                        const answer = await handleAgentEvent(event);
                        if (subLack !== 'headlessEnabled') {
                            setConfigValue(subConfig, subLack, answer);
                        }
                        if (subLack === 'headlessEnabled' && answer) {
                            subConfig.im = {} as DeepclawConfig['agents'][0]['im'];
                            for (const key of ['engine', 'appId', 'secret']) {
                                const event = APP_CONFIG_EVENTS[`agents.im.${key}`]!;
                                const answer = await handleAgentEvent(event);
                                setConfigValue(subConfig.im, key, answer);
                            }
                        }
                    }
                }
            }
        }
    }
    writeAppConfig(config);
}

function setConfigValue(target: any, path: string, value: any) {
    const keys = path.split('.');
    let current = target;
    for (let i = 0; i < keys.length; i++) {
        if (i === keys.length - 1) {
            current[keys[i]!] = value;
        } else {
            current = current[keys[i]!];
        }
    }
}

function ensureBasicFiles() {
    FileUtils.copyResource(import.meta.dirname, 'DEEPCLAW.md');
    FileUtils.copyResource(import.meta.dirname, 'skills');
}
