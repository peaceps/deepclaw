import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest';
import {FileStore} from '@deepclaw/node-utils';
import {
    AGENTS_DIR, CRON_DIR, FILES_DIR, OUTPUT_DIR, PROJECT_DIR, SKILLS, SKILLS_DIR,
    cronFilesDir, cronOutputDir, projectFilesDir, projectOutputDir
} from './paths';

describe('derived paths', () => {

    test('keeps the skills next to the agents', () => {
        expect(SKILLS_DIR).toBe(`${AGENTS_DIR}/${SKILLS}`);
    });

    test('hands the files of a task over from inside the folder of its project', () => {
        expect(projectFilesDir('p1')).toBe(`${PROJECT_DIR}/p1/${FILES_DIR}`);
        expect(projectOutputDir('p1')).toBe(`${PROJECT_DIR}/p1/${OUTPUT_DIR}`);
    });

    test('hands the files of a scheduled run over from inside the folder of its task', () => {
        expect(cronFilesDir('c1')).toBe(`${CRON_DIR}/c1/${FILES_DIR}`);
        expect(cronOutputDir('c1')).toBe(`${CRON_DIR}/c1/${OUTPUT_DIR}`);
    });

    /** The report of a run and the files it produced are two things to tell apart in a folder. */
    test('keeps what a run hands over apart from what it says', () => {
        const folders = [
            projectFilesDir('p1'), projectOutputDir('p1'), cronFilesDir('p1'), cronOutputDir('p1')
        ];
        expect(new Set(folders).size).toBe(folders.length);
    });
});

/**
 * The store names the folders it serves from over again, since it knows nothing of an agent. Only
 * a file written under these paths and read back through a url proves the two still say the same:
 * apart, the writing side goes on handing out links and the reading side answers every one of them
 * with nothing.
 */
describe('the folders a run hands over from, as the store sees them', () => {
    let tempDir = '';

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-paths-'));
        // The data root is named by the environment, and a test of it says which one it means.
        vi.stubEnv('DEEPCLAW_HOME', tempDir);
    });

    afterAll(() => {
        vi.unstubAllEnvs();
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    function written(folder: string, name: string): string {
        fs.mkdirSync(path.join(tempDir, folder), {recursive: true});
        fs.writeFileSync(path.join(tempDir, folder, name), `the file in ${folder}`);
        return `${folder}/${name}`;
    }

    test.each([
        ['the files of a project', projectFilesDir('p1')],
        ['the reports of a project', projectOutputDir('p1')],
        ['the files of a scheduled task', cronFilesDir('c1')],
        ['the reports of a scheduled task', cronOutputDir('c1')],
    ])('serves %s back', (_unused, folder) => {
        const file = written(folder, 'report.pdf');
        const key = FileStore.keyOf(FileStore.urlOf(file));
        expect(key).not.toBeNull();
        expect(FileStore.read(key!)?.toString()).toBe(`the file in ${folder}`);
    });
});
