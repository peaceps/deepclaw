import { type LLMConfig } from "@deepclaw/config";
import { LLMProtocol } from "./definitions/definitions";

/**
 * Which protocol an agent is spoken to in: the one written in its config, and the url read for it
 * where nothing is. Everything that builds a loop or decides that a built one is of the wrong class
 * asks this, so that a pick and a guess are the same answer to whoever acts on it.
 *
 * Whether the answer is one we have a loop for is not asked here. That is known where the loop is
 * built and nowhere else, and a name read out of a file is only ever as good as the list it is
 * checked against.
 */
export function agentProtocolOf(llm: LLMConfig): LLMProtocol | null {
    return llm.protocol || detectAgentProtocolFromUrl(llm.baseURL);
}

// TODO CHECK FOR OPENAI RESPONSE
export function detectAgentProtocolFromUrl(baseURL: string): LLMProtocol | null {
    baseURL = baseURL.replace(/\/$/, "").toLowerCase();
    if (!baseURL) return null;
    try {
        new URL(baseURL);
    } catch {
        return null;
    }
    if (baseURL.includes("anthropic")) {
        return "Anthropic";
    }
    return "OpenAIChat";
}

// TODO CHECK FOR OPENAI RESPONSE
export async function detectAgentSDKFromRequest(
    baseURL: string,
    apiKey: string
): Promise<LLMProtocol | null> {
    baseURL = baseURL.replace(/\/$/, "");
    try {
        const openaiRes = await fetch(`${baseURL}/models`, {
            headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
        });
        if (openaiRes.status !== 404 && openaiRes.status !== 405) {
            return "OpenAIChat";
        }
    } catch {}

    try {
        const anthropicRes = await fetch(`${baseURL}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                ...(apiKey ? {"x-api-key": apiKey} : {}),
            },
            body: JSON.stringify({
                model: "test",
                max_tokens: 1,
                messages: [{ role: "user", content: "hello"}],
            }),
        });
        if (anthropicRes.status !== 404 && anthropicRes.status !== 405) {
            return "Anthropic";
        }
    } catch {}

    return null;
}
