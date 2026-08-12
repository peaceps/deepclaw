import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import { ImageStore } from './image-store';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const LOOP = 'agent.a1';

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
        const key = ImageStore.save(PNG, 'png', LOOP);
        expect(ImageStore.read(key)).toEqual(PNG);
    });

    test('files the picture under its loop and names it after the hash of the bytes', () => {
        expect(ImageStore.save(PNG, 'png', LOOP)).toMatch(/^agent\.a1\/[a-f0-9]{16}\.png$/);
    });

    /** Whoever hands over a loop id is free to name it, the store still has to stay one folder deep. */
    test('keeps a loop id that would reach elsewhere inside the store', () => {
        const key = ImageStore.save(PNG, 'png', '../../elsewhere');
        expect(key).toMatch(/^[^/]+\/[a-f0-9]{16}\.png$/);
        expect(key).not.toContain('..');
        expect(ImageStore.read(key)).toEqual(PNG);
    });

    test('keeps the same picture of one loop only once', () => {
        const key = ImageStore.save(PNG, 'png', LOOP);
        ImageStore.save(Buffer.from(PNG), 'png', LOOP);
        const files = fs.readdirSync(path.join(tempDir, '.images', LOOP));
        expect(files.filter(file => `${LOOP}/${file}` === key)).toHaveLength(1);
    });

    test('tells two pictures of the same type apart', () => {
        expect(ImageStore.save(Buffer.from('one'), 'png', LOOP))
            .not.toBe(ImageStore.save(Buffer.from('another'), 'png', LOOP));
    });

    /** Sessions written before the loops had a folder point straight at the file. */
    test('reads a key that names no loop', () => {
        fs.mkdirSync(path.join(tempDir, '.images'), {recursive: true});
        fs.writeFileSync(path.join(tempDir, '.images', '0123456789abcdef.png'), PNG);
        expect(ImageStore.read('0123456789abcdef.png')).toEqual(PNG);
    });

    test('answers with nothing for a key it never stored', () => {
        expect(ImageStore.read('agent.a1/fedcba9876543210.png')).toBeNull();
    });

    test('refuses a key that tries to walk out of the store', () => {
        expect(ImageStore.read('../../etc/passwd')).toBeNull();
        expect(ImageStore.read('../0123456789abcdef.png')).toBeNull();
    });
});
