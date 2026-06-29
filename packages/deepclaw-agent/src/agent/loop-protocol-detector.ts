import { LLMProtocol } from "./definitions/definitions";

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
