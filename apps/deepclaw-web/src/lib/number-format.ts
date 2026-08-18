/** Past six digits a number stops being read and starts being counted, so the big ones are named. */
const UNITS = [
    {limit: 1_000_000_000, suffix: 'B'},
    {limit: 1_000_000, suffix: 'M'},
] as const;

export function formatCount(count: number): string {
    const index = UNITS.findIndex(({limit}) => count >= limit);
    if (index < 0) {
        return String(count);
    }
    // Two decimals are as fine as such a number gets, and trailing zeros of it say nothing.
    const scaled = Number((count / UNITS[index]!.limit).toFixed(2));
    // Rounding can fill the unit above: a count a hair under a billion reads as 1B, not 1000M.
    return scaled >= 1000 && index > 0
        ? `${scaled / 1000}${UNITS[index - 1]!.suffix}`
        : `${scaled}${UNITS[index]!.suffix}`;
}

/** A share tells more as a percentage, and two decimals of one are already more than it can say. */
export function formatPercent(ratio: number): string {
    return `${Number((ratio * 100).toFixed(2))}%`;
}
