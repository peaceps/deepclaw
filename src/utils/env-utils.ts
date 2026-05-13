import process from "node:process";

export function hasEnvVariable(name: string): boolean {
    return name in process.env;
}

export function getEnvVariable(name: string): string {
    return process.env[name] || '';
}