import {describe, expect, test} from 'vitest';
import {
    imageExtensionOf, imageKeyExtension, imageKeyMediaType, imageRefKey, isImageName, isImageRef,
    newImageRef, parseDataUrl
} from './image-ref';

describe('image references', () => {

    test('carries the key of the stored bytes', () => {
        expect(imageRefKey(newImageRef('abc123.png'))).toBe('abc123.png');
    });

    test('leaves a url that is not a reference alone', () => {
        expect(imageRefKey('https://host/shot.png')).toBeNull();
        expect(imageRefKey('data:image/png;base64,QUJD')).toBeNull();
        expect(isImageRef('https://host/shot.png')).toBe(false);
    });

    test('recognises its own references', () => {
        expect(isImageRef(newImageRef('abc123.png'))).toBe(true);
    });
});

describe('image types', () => {

    test('names the file after the type of the image', () => {
        expect(imageKeyExtension('image/png')).toBe('png');
        expect(imageKeyExtension('image/jpeg')).toBe('jpg');
        expect(imageKeyExtension('IMAGE/WEBP')).toBe('webp');
    });

    test('falls back to a neutral extension for a type it does not know', () => {
        expect(imageKeyExtension('image/heic')).toBe('bin');
    });

    test('reads the type back out of the key', () => {
        expect(imageKeyMediaType('abc123.jpg')).toBe('image/jpeg');
        expect(imageKeyMediaType('abc123.png')).toBe('image/png');
    });

    test('answers with a neutral type for a key it cannot place', () => {
        expect(imageKeyMediaType('abc123.bin')).toBe('application/octet-stream');
    });

    test('names the extension a picture would be stored under', () => {
        expect(imageExtensionOf('out/chart.png')).toBe('png');
        expect(imageExtensionOf('shot.JPEG')).toBe('jpg');
        expect(imageExtensionOf('loop.gif')).toBe('gif');
    });

    test('answers with nothing for a file that is no picture', () => {
        expect(imageExtensionOf('report.pdf')).toBeNull();
        expect(imageExtensionOf('sheet.csv')).toBeNull();
        expect(imageExtensionOf('README')).toBeNull();
    });

    test('says of a name whether it is one of a picture', () => {
        expect(isImageName('out/chart.png')).toBe(true);
        expect(isImageName('shot.JPEG')).toBe(true);
        expect(isImageName('report.pdf')).toBe(false);
        expect(isImageName('README')).toBe(false);
    });
});

describe('data urls', () => {

    test('splits the type from the payload', () => {
        expect(parseDataUrl('data:image/png;base64,QUJD')).toEqual({mediaType: 'image/png', base64: 'QUJD'});
    });

    test('answers with nothing for a url that carries no data', () => {
        expect(parseDataUrl('https://host/shot.png')).toBeNull();
        expect(parseDataUrl('dcimg://abc123.png')).toBeNull();
    });
});
