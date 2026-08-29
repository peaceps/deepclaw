/**
 * How an endpoint is spoken to, each named after the api it answers on. A loop is built to one of
 * these and speaks nothing else for as long as it lives, so this is the whole of what an agent can
 * be told to use. Kept out of the config module for the same reason the image models are: the
 * settings ui offers the list without pulling the whole configuration in behind it.
 */
export const LLM_PROTOCOLS = ['Anthropic', 'OpenAIChat', 'OpenAIResponse'] as const;

export type LLMProtocol = typeof LLM_PROTOCOLS[number];
