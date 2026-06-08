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
        // const agentsIndex = appConfig.lacks.indexOf('agents');
        // if (agentsIndex !== -1) {
        //     appConfig.config.agents = [{
        //         standaloneTask: 'transient',
        //         llm: {}
        //     } as DeepclawConfig['agents'][0]];
        //     appConfig.lacks.splice(agentsIndex, 1, {
        //         agents: {
        //             0: ['name', 'mode', 'headlessEnabled', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model']
        //         }
        //     });
        // }
        // const agentsLack = appConfig.lacks.find(lack => typeof lack === 'object')?.agents;
        // if (agentsLack) {
        //     Object.values(agentsLack).forEach(lack => lac)
        // }
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
            if (lack === 'agents') {
                config.agents.push({standaloneTask: 'transient', llm: {}} as DeepclawConfig['agents'][0]);
                lacks.push({
                    agents: {
                        0: ['name', 'mode', 'llm.provider', 'llm.baseUrl', 'llm.apiKey', 'llm.model']
                    }
                });
                continue;
            }
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
                        setConfigValue(subConfig, subLack, answer);
                        if (subLack === 'headlessEnabled' && subConfig.headlessEnabled) {
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
