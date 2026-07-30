import {describe, expect, test} from 'vitest';
import {colorClassMap, type DeepColors} from './laf-types';

const COLORS: DeepColors[] = [
    'blue', 'purple', 'green', 'orange', 'emerald', 'pink', 'fuchsia', 'gray', 'cyan',
    'red', 'yellow', 'lime', 'sky', 'amber', 'indigo', 'violet', 'rose',
];

function expectedClasses(color: DeepColors): Record<string, string> {
    return {
        text: `text-${color}-500`,
        textMuted: `text-${color}-700`,
        bg: `bg-${color}-50`,
        bgHover: `hover:bg-${color}-100`,
        border: `border-${color}-200`,
        borderFocus: `focus:border-${color}-300`,
        ringFocus: `focus:ring-${color}-300`,
        hoverText: `hover:text-${color}-500`,
        hoverBg: `hover:bg-${color}-50`,
        peerFocusRing300: `peer-focus:ring-${color}-300`,
        peerCheckedBg600: `peer-checked:bg-${color}-600`,
    };
}

describe('colorClassMap', () => {

    test('has an entry for every supported color and nothing else', () => {
        expect(Object.keys(colorClassMap).sort()).toEqual([...COLORS].sort());
    });

    test.each(COLORS)('builds every %s class from the color name', (color) => {
        expect(colorClassMap[color]).toEqual(expectedClasses(color));
    });

    test('gives every entry the same class slots in the same order', () => {
        const slots = Object.keys(colorClassMap.blue);
        for (const color of COLORS) {
            expect(Object.keys(colorClassMap[color])).toEqual(slots);
        }
    });

    test('keeps every class string unique across the whole map', () => {
        const classes = COLORS.flatMap(color => Object.values(colorClassMap[color]));
        expect(new Set(classes).size).toBe(classes.length);
    });
});
