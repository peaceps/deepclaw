import {describe, expect, test} from 'vitest';
import {popupPlacement, type AnchorRect} from './popup-placement';

const VIEWPORT = {width: 1000, height: 800};
const SIZE = {width: 160, maxHeight: 240};

function anchor(overrides: Partial<AnchorRect> = {}): AnchorRect {
    return {top: 100, bottom: 120, left: 200, ...overrides};
}

describe('popupPlacement', () => {

    test('hangs the list under the anchor while there is room for it there', () => {
        expect(popupPlacement(anchor(), VIEWPORT, SIZE)).toEqual({
            top: 124, left: 200, maxHeight: 240,
        });
    });

    test('flips the list above an anchor near the bottom of the page', () => {
        const placement = popupPlacement(anchor({top: 700, bottom: 720}), VIEWPORT, SIZE);
        expect(placement).toEqual({bottom: 104, left: 200, maxHeight: 240});
        expect(placement.top).toBeUndefined();
    });

    /** The room above is what is left of it, so the list is cut to fit rather than hung off the top. */
    test('cuts the flipped list to the room above the anchor', () => {
        expect(popupPlacement(anchor({top: 150, bottom: 780}), VIEWPORT, SIZE)).toEqual({
            bottom: 654, left: 200, maxHeight: 138,
        });
    });

    test('cuts the list to the room under the anchor when under is still the roomier side', () => {
        expect(popupPlacement(anchor({top: 20, bottom: 600}), VIEWPORT, SIZE)).toEqual({
            top: 604, left: 200, maxHeight: 188,
        });
    });

    /** Neither side has anything to offer, and a negative height is no height at all. */
    test('asks for no height at all where there is none on either side', () => {
        const placement = popupPlacement(anchor({top: 0, bottom: 800}), VIEWPORT, SIZE);
        expect(placement.maxHeight).toBe(0);
    });

    test('pulls a list at the right edge back inside the page', () => {
        expect(popupPlacement(anchor({left: 960}), VIEWPORT, SIZE).left).toBe(832);
    });

    test('keeps a list off the left edge of a page too narrow to hold it', () => {
        expect(popupPlacement(anchor({left: 4}), {width: 100, height: 800}, SIZE).left).toBe(8);
    });
});
