/**
 * The models an agent can be told to draw with, each named the way its vendor names it: the
 * choice travels into the request unchanged, and an abbreviated name is refused there. Kept out
 * of the config module so the settings ui can offer the list without pulling the whole
 * configuration in behind it.
 */
export const IMAGE_MODELS = [
    'doubao-seedream-5-0-pro-260628',
    'doubao-seedream-5-0-260128',
    'doubao-seedream-4-5-251128',
    'doubao-seedream-4-0-250828',
    'qwen-image-3.0',
    'qwen-image-2.0-pro-2026-06-22',
    'gpt-image-2.0'
] as const;

export type ImageModel = typeof IMAGE_MODELS[number];
