export type ImageRequest = {
    prompt: string;
    negativePrompt?: string;
    size?: string;
};

// Drawing regularly takes half a minute, a vendor under load takes considerably longer.
const GENERATION_TIMEOUT_MS = 180_000;

/**
 * One vendor that can draw a picture. Every one of them answers with a link that expires
 * within a day, so whoever asks for a drawing has to keep the bytes right away.
 */
export abstract class ImageGenerator {
    protected model: string;
    private apiKey: string;

    constructor(model: string, apiKey: string) {
        this.model = model;
        this.apiKey = apiKey;
    }

    /** The link of the drawn picture. */
    public abstract draw(request: ImageRequest): Promise<string>;

    protected async ask<T>(url: string, body: object): Promise<T> {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`},
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
        });
        const answer = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) {
            throw new Error(`Image generation failed (${response.status}): ${reasonOf(answer)}`);
        }
        return answer as T;
    }
}

/** Dashscope names the reason at the top of its answer, ark wraps it in an error object. */
function reasonOf(answer: unknown): string {
    const body = (answer ?? {}) as {message?: string; code?: string; error?: {message?: string; code?: string}};
    return body.error?.message || body.message || body.error?.code || body.code || 'no reason given';
}
