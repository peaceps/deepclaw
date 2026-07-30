import {describe, expect, test} from 'vitest';
import {
    AGENTS_DIR, CRON_OUTPUT_DIR, PROJECT_TASK_OUTPUT_DIR, PUBLIC, SKILLS, SKILLS_DIR
} from './paths';

describe('derived paths', () => {

    test('keeps the skills next to the agents', () => {
        expect(SKILLS_DIR).toBe(`${AGENTS_DIR}/${SKILLS}`);
    });

    test('serves the task output from inside the public folder', () => {
        expect(PROJECT_TASK_OUTPUT_DIR.startsWith(`${PUBLIC}/`)).toBe(true);
    });

    test('serves the cron output from inside the public folder', () => {
        expect(CRON_OUTPUT_DIR.startsWith(`${PUBLIC}/`)).toBe(true);
    });

    test('keeps the two output folders apart', () => {
        expect(PROJECT_TASK_OUTPUT_DIR).not.toBe(CRON_OUTPUT_DIR);
    });
});
