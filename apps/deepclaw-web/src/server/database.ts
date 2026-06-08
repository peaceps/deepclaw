import {validateCurrentAppConfig} from '@deepclaw/gateway';

const db: any = {
    configValid: validateCurrentAppConfig(false).lacks.length === 0,
};

export function isConfigValid(): boolean {
    return db.configValid;
}

export function setConfigValid(valid: boolean): void {
    db.configValid = valid;
}