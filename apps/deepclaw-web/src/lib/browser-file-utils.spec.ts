import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {copyText, fetchFile, getFileNameFromPath, saveToFile} from './browser-file-utils';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn<(path: string) => Promise<Response>>(),
    createObjectURL: vi.fn<(blob: Blob | MediaSource) => string>(),
    revokeObjectURL: vi.fn<(url: string) => void>(),
    click: vi.fn<() => void>(),
    appendChild: vi.fn<(node: unknown) => void>(),
    removeChild: vi.fn<(node: unknown) => void>(),
    writeText: vi.fn<(text: string) => Promise<void>>(),
    select: vi.fn<() => void>(),
    execCommand: vi.fn<(command: string) => boolean>(),
}));

type FakeAnchor = {href: string; download: string; click: () => void};

type FakeField = {value: string; style: Record<string, string>; select: () => void};

let anchor: FakeAnchor;

let field: FakeField;

function newResponse(overrides: Partial<Response> = {}): Response {
    return {ok: true, status: 200, text: async () => 'file body', ...overrides} as Response;
}

function savedBlob(): Blob {
    return mocks.createObjectURL.mock.calls[0][0] as Blob;
}

describe('fetchFile', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.fetch.mockResolvedValue(newResponse());
        vi.stubGlobal('fetch', mocks.fetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('reads the body of the response', async () => {
        await expect(fetchFile('/skills/readme.md')).resolves.toBe('file body');
    });

    test('asks for the given path', async () => {
        await fetchFile('/skills/readme.md');
        expect(mocks.fetch).toHaveBeenCalledWith('/skills/readme.md');
    });

    test('throws with the status when the response failed', async () => {
        mocks.fetch.mockResolvedValue(newResponse({ok: false, status: 404}));
        await expect(fetchFile('/missing.md')).rejects.toThrow('Fetch failed: 404');
    });

    test('lets a network failure through', async () => {
        mocks.fetch.mockRejectedValue(new Error('offline'));
        await expect(fetchFile('/skills/readme.md')).rejects.toThrow('offline');
    });
});

describe('getFileNameFromPath', () => {

    test('takes the last segment of a posix path', () => {
        expect(getFileNameFromPath('/skills/docs/readme.md')).toBe('readme.md');
    });

    test('takes the last segment of a windows path', () => {
        expect(getFileNameFromPath('C:\\skills\\docs\\readme.md')).toBe('readme.md');
    });

    test('handles a path that mixes both separators', () => {
        expect(getFileNameFromPath('C:\\skills/docs\\readme.md')).toBe('readme.md');
    });

    test('returns a bare file name unchanged', () => {
        expect(getFileNameFromPath('readme.md')).toBe('readme.md');
    });

    test('returns nothing for a path that ends in a separator', () => {
        expect(getFileNameFromPath('/skills/docs/')).toBe('');
        expect(getFileNameFromPath('C:\\skills\\')).toBe('');
    });

    test('returns nothing for an empty path', () => {
        expect(getFileNameFromPath('')).toBe('');
    });
});

describe('copyText', () => {

    /** A page with no clipboard of its own, which is what http to anywhere but this machine is. */
    function withoutClipboard(): void {
        vi.stubGlobal('navigator', {});
    }

    beforeEach(() => {
        vi.clearAllMocks();
        field = {value: '', style: {}, select: mocks.select};
        mocks.execCommand.mockReturnValue(true);
        vi.stubGlobal('navigator', {clipboard: {writeText: mocks.writeText}});
        vi.stubGlobal('document', {
            createElement: () => field,
            execCommand: mocks.execCommand,
            body: {appendChild: mocks.appendChild, removeChild: mocks.removeChild},
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('hands the text to the clipboard of the browser', async () => {
        await copyText('# Report');
        expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith('# Report');
        expect(mocks.appendChild).not.toHaveBeenCalled();
    });

    test('lets a refusal of the clipboard through', async () => {
        mocks.writeText.mockRejectedValue(new Error('denied'));
        await expect(copyText('# Report')).rejects.toThrow('denied');
    });

    test('copies a selection nobody sees where there is no clipboard', async () => {
        withoutClipboard();
        await copyText('# Report');
        expect(field.value).toBe('# Report');
        expect(mocks.select).toHaveBeenCalledOnce();
        expect(mocks.execCommand).toHaveBeenCalledWith('copy');
    });

    test('keeps the field it selects off the screen', async () => {
        withoutClipboard();
        await copyText('# Report');
        expect(field.style).toEqual({position: 'fixed', top: '-1000px'});
    });

    test('takes the field back out of the page', async () => {
        withoutClipboard();
        await copyText('# Report');
        expect(mocks.appendChild).toHaveBeenCalledWith(field);
        expect(mocks.removeChild).toHaveBeenCalledWith(field);
    });

    test('says so when the browser would not copy the selection either', async () => {
        withoutClipboard();
        mocks.execCommand.mockReturnValue(false);
        await expect(copyText('# Report')).rejects.toThrow('would not copy');
        // The page is left as it was found, whether the copy took or not.
        expect(mocks.removeChild).toHaveBeenCalledWith(field);
    });
});

describe('saveToFile', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        anchor = {href: '', download: '', click: mocks.click};
        mocks.createObjectURL.mockReturnValue('blob:deepclaw/1');
        vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createObjectURL);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mocks.revokeObjectURL);
        vi.stubGlobal('document', {
            createElement: () => anchor,
            body: {appendChild: mocks.appendChild, removeChild: mocks.removeChild},
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test('wraps the content in a plain text blob', async () => {
        saveToFile('hello world', 'notes.txt');
        expect(savedBlob().type).toBe('text/plain');
        await expect(savedBlob().text()).resolves.toBe('hello world');
    });

    test('downloads the object url under the given file name', () => {
        saveToFile('hello world', 'notes.txt');
        expect(anchor).toMatchObject({href: 'blob:deepclaw/1', download: 'notes.txt'});
        expect(mocks.click).toHaveBeenCalledOnce();
    });

    test('puts the anchor into the document and takes it out again', () => {
        saveToFile('hello world', 'notes.txt');
        expect(mocks.appendChild).toHaveBeenCalledWith(anchor);
        expect(mocks.removeChild).toHaveBeenCalledWith(anchor);
    });

    test('releases the object url', () => {
        saveToFile('hello world', 'notes.txt');
        expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:deepclaw/1');
    });

    test('saves empty content as an empty file', async () => {
        saveToFile('', 'empty.txt');
        await expect(savedBlob().text()).resolves.toBe('');
    });
});
