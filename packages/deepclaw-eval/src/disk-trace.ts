import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '@deepclaw/core';

export type DiskTrace = {
    status: string;
    turns: number;
    finalText: string;
    usage?: {cachedInputTokens: number, noCachedInputTokens: number, outputTokens: number};
    transitionReason?: string;
    messages: unknown[];
    project?: Project;
};

/**
 * What survived the run on disk. This is the part a user would still see after a restart, so
 * it is read back from the files rather than taken from the objects still in memory.
 */
export function readDiskTrace(home: string, sessionDir: string, projectId?: string): DiskTrace {
    const meta = readJson<any>(join(home, sessionDir, 'session.json'));
    return {
        status: meta?.runtime?.status || 'unknown',
        turns: meta?.runtime?.turnCount ?? 0,
        finalText: meta?.runtime?.finalText || '',
        usage: meta?.runtime?.usage,
        transitionReason: meta?.runtime?.transitionReason,
        messages: readJsonl(join(home, sessionDir, 'messages.jsonl')),
        project: projectId
            ? readJson<Project>(join(home, '.projects', projectId, 'project.json')) ?? undefined
            : undefined,
    };
}

function readJson<T>(path: string): T | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
        return null;
    }
}

function readJsonl(path: string): unknown[] {
    if (!existsSync(path)) {
        return [];
    }
    return readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => !!line.trim())
        .map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return {unparsable: line};
            }
        });
}
