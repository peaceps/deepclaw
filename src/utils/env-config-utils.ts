import process from "node:process";
import path from 'path';
import dotenv from 'dotenv';
import { FileUtils } from './file-utils';

const ENV_PATH = '.env';

dotenv.config({ path: path.join(process.cwd(), ENV_PATH), quiet: true });

export type EnvConfig = {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    responseApi?: string;
}

export function validateEnvFile(): Partial<EnvConfig> {
    const config: Partial<EnvConfig> = {};

    const provider = (hasEnvVariable('OPENAI_API_KEY') || hasEnvVariable('OPENAI_BASE_URL')) ? 'openai'
    : ((hasEnvVariable('ANTHROPIC_API_KEY') || hasEnvVariable('ANTHROPIC_BASE_URL')) ? 'anthropic' : undefined);

    if (provider) {
       config.provider = provider;
    }
    if (hasEnvVariable('OPENAI_BASE_URL') || hasEnvVariable('ANTHROPIC_BASE_URL')) {
        config.baseUrl = getEnvVariable('OPENAI_BASE_URL') ?? getEnvVariable('ANTHROPIC_BASE_URL');
    }
    if (hasEnvVariable('OPENAI_API_KEY') || hasEnvVariable('ANTHROPIC_API_KEY')) {
        config.apiKey = getEnvVariable('OPENAI_API_KEY') ?? getEnvVariable('ANTHROPIC_API_KEY');
    }
    if (hasEnvVariable('MODEL_ID')) {
        config.model = getEnvVariable('MODEL_ID');
    }
    if (provider === 'openai' && hasEnvVariable('OPENAI_RESPONSE_API')) {
        config.responseApi = getEnvVariable('OPENAI_RESPONSE_API').toLowerCase()
    }
    return config;
}

export function writeEnvConfig(config: EnvConfig) {
    const provider = config.provider.toUpperCase();
    const content = 
`${provider}_BASE_URL=${config.baseUrl}
${provider}_API_KEY=${config.apiKey}
MODEL_ID=${config.model}
${writeResponseApi(config)}
`;
    FileUtils.writeFile(ENV_PATH, content);
    dotenv.config({ path: path.join(process.cwd(), ENV_PATH), quiet: true });
}

function writeResponseApi(config: EnvConfig): string {
    if (config.provider !== 'openai') {
        return '';
    }
    return `OPENAI_RESPONSE_API=${config.responseApi?.toLocaleLowerCase() === 'true' ? 'TRUE' : 'FALSE'}`;
}

export function hasEnvVariable(name: string): boolean {
    return name in process.env;
}

export function getEnvVariable(name: string, defaultValue?: string): string {
    return (process.env[name] || defaultValue || '').trim();
}
