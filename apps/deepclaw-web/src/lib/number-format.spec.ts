import {describe, expect, test} from 'vitest';
import {formatCount, formatPercent} from './number-format';

describe('formatCount', () => {

    test('leaves a count below a million as it is', () => {
        expect(formatCount(999_999)).toBe('999999');
    });

    test('leaves zero alone', () => {
        expect(formatCount(0)).toBe('0');
    });

    test('names a million', () => {
        expect(formatCount(1_000_000)).toBe('1M');
    });

    test('names a billion', () => {
        expect(formatCount(1_000_000_000)).toBe('1B');
    });

    test('keeps two decimals at most', () => {
        expect(formatCount(1_234_567)).toBe('1.23M');
        expect(formatCount(12_345_678_900)).toBe('12.35B');
    });

    test('drops the decimals that are only zeros', () => {
        expect(formatCount(2_500_000)).toBe('2.5M');
        expect(formatCount(3_000_000_000)).toBe('3B');
    });

    test('rounds what a third decimal would have added', () => {
        expect(formatCount(1_236_000)).toBe('1.24M');
    });

    test('takes the largest unit the count reaches', () => {
        expect(formatCount(1_500_000_000)).toBe('1.5B');
    });

    test('lets a count that rounds up move to the unit above', () => {
        expect(formatCount(999_999_999)).toBe('1B');
    });
});

describe('formatPercent', () => {

    test('reads a share as a percentage', () => {
        expect(formatPercent(0.5)).toBe('50%');
    });

    test('keeps two decimals at most', () => {
        expect(formatPercent(0.832456)).toBe('83.25%');
    });

    test('drops the decimals that are only zeros', () => {
        expect(formatPercent(1)).toBe('100%');
        expect(formatPercent(0.105)).toBe('10.5%');
    });

    test('says nothing was hit as zero', () => {
        expect(formatPercent(0)).toBe('0%');
    });
});
