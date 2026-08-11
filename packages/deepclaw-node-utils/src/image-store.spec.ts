import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import { ImageStore } from './image-store';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe('ImageStore', () => {
    const originCwd = process.cwd();
    let tempDir = '';

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepclaw-images-'));
        process.chdir(tempDir);
    });

    afterAll(() => {
        process.chdir(originCwd);
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    test('reads back the bytes it was given', () => {
        const key = ImageStore.save(PNG, 'png');
        expect(ImageStore.read(key)).toEqual(PNG);
    });

    test('names the file after the hash of the bytes and its type', () => {
        expect(ImageStore.save(PNG, 'png')).toMatch(/^[a-f0-9]{16}\.png$/);
    });

    test('keeps the same picture only once', () => {
        const key = ImageStore.save(PNG, 'png');
        ImageStore.save(Buffer.from(PNG), 'png');
        expect(fs.readdirSync(path.join(tempDir, '.images')).filter(file => file === key)).toHaveLength(1);
    });

    test('tells two pictures of the same type apart', () => {
        expect(ImageStore.save(Buffer.from('one'), 'png'))
            .not.toBe(ImageStore.save(Buffer.from('another'), 'png'));
    });

    test('answers with nothing for a key it never stored', () => {
        expect(ImageStore.read('0123456789abcdef.png')).toBeNull();
    });

    test('refuses a key that tries to walk out of the store', () => {
        expect(ImageStore.read('../../etc/passwd')).toBeNull();
    });
});
