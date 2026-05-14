import {describe, expect, test} from '@jest/globals';
import { FileUtils } from './file-utils';

describe('FileUtils', () => {
    test('returns true for workspace-relative path', () => {
        expect(FileUtils.isPathInWorkspace('src/utils/file-utils.ts')).toBeTruthy();
    });
});