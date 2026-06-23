import { loadAgentConfig } from "@deepclaw/config";
import type { LoopProtocol } from "@deepclaw/agent";

export function detectAgentSDKFromUrl(agentId: string): LoopProtocol | null {
    const agentConfig = loadAgentConfig(agentId);
    const baseURL = agentConfig.llm.baseURL.replace(/\/$/, "");
    if (baseURL.includes("anthropic")) {
        return "anthropic";
    }
    if (
        baseURL.includes("openai") ||
        baseURL.includes("compatible-mode") ||
        baseURL.endsWith("/v1")
    ) {
        return "openai";
    }
    return null;
}

export async function detectAgentSDKFromRequest(
    agentId: string,
): Promise<LoopProtocol | null> {
    const agentConfig = loadAgentConfig(agentId);
    const baseURL = agentConfig.llm.baseURL.replace(/\/$/, "");
    const apiKey = agentConfig.llm.apiKey;
    try {
        const openaiRes = await fetch(`${baseURL}/models`, {
            headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
        });
        if (openaiRes.status !== 404 && openaiRes.status !== 405) {
            return "openai";
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
            return "anthropic";
        }
    } catch {}

    return null;
}
