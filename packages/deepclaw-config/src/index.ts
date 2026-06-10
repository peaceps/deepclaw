import './i18n';

export {DEFAULT_LANG, type DeepclawConfig, loadConfig, loadAgentConfig, writeAppConfig, validateCurrentAppConfig, validateAppConfig, type MissingAppConfig} from './app-config';
export * from './app-config-fixer';
export * from './app-config-events';
