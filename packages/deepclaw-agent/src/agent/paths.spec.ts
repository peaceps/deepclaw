import {describe, expect, test} from 'vitest';
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
