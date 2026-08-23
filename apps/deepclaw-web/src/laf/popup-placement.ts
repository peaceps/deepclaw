export type AnchorRect = {
    top: number;
    bottom: number;
    left: number;
};

export type Viewport = {
    width: number;
    height: number;
};

/**
 * What the popup asks for. The width is what it is held to as well as placed by: a list wider than
 * the width it was pulled back from the edge with would hang out over that edge anyway.
 */
export type PopupSize = {
    width: number;
    maxHeight: number;
};

export type PopupPlacement = {
    left: number;
    maxHeight: number;
} & ({top: number; bottom?: undefined} | {bottom: number; top?: undefined});

/** How far a popup hangs off the thing it belongs to, and how near it may come to an edge. */
const GAP = 4;
const EDGE = 8;

/**
 * Where a list hung on an anchor goes: under it while there is room under it, above it once what
 * is under the anchor is the smaller of the two halves, and never taller than the side it took.
 * A card near the bottom of the page would otherwise hang its list off the screen, where what it
 * offers can be neither read nor reached, and one at the right edge would hang it out the side.
 */
export function popupPlacement(anchor: AnchorRect, viewport: Viewport, size: PopupSize): PopupPlacement {
    const under = viewport.height - anchor.bottom - GAP - EDGE;
    const over = anchor.top - GAP - EDGE;
    const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - size.width - EDGE));
    if (under >= size.maxHeight || under >= over) {
        return {top: anchor.bottom + GAP, left, maxHeight: room(size.maxHeight, under)};
    }
    return {bottom: viewport.height - anchor.top + GAP, left, maxHeight: room(size.maxHeight, over)};
}

function room(wanted: number, available: number): number {
    return Math.max(0, Math.min(wanted, available));
}
