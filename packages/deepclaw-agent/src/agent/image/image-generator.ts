export type ImageRequest = {
    prompt: string;
    negativePrompt?: string;
    size?: string;
    /** Pictures to draw from, each one a data url or a link the vendor can fetch itself. */
    images?: string[];
};

// Drawing regularly takes half a minute, a vendor under load takes considerably longer.
const GENERATION_TIMEOUT_MS = 180_000;

/**
 * One vendor that can draw a picture. A vendor answers either with a link that expires within
 * a day or with the bytes inline, so whoever asks for a drawing has to keep them right away.
 */
export abstract class ImageGenerator {
    protected model: string;
    private apiKey: string;

    constructor(model: string, apiKey: string) {
        this.model = model;
        this.apiKey = apiKey;
    }

    /** The drawn picture, as a link or as a data url. */
    public abstract draw(request: ImageRequest, signal?: AbortSignal): Promise<string>;

    protected async ask<T>(url: string, body: object, signal?: AbortSignal): Promise<T> {
        return this.answerOf(await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...this.authorization()},
            body: JSON.stringify(body),
            signal: this.deadline(signal),
        }));
    }

    /** For a vendor that reads the pictures to draw from off the request instead of a json field. */
    protected async askForm<T>(url: string, form: FormData, signal?: AbortSignal): Promise<T> {
        return this.answerOf(await fetch(url, {
            method: 'POST',
            // no content type of ours: only fetch knows the boundary it writes the parts with
            headers: this.authorization(),
            body: form,
            signal: this.deadline(signal),
        }));
    }

    /**
     * The three minutes a drawing is given and the stop of the run, as the one signal either can
     * fire. Both are needed: three minutes is a long time to sit in front of a button that did
     * nothing, and giving up the timeout to gain the stop would leave a run waiting forever on a
     * vendor that never answers.
     */
    protected deadline(signal?: AbortSignal): AbortSignal {
        const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
        return signal ? AbortSignal.any([timeout, signal]) : timeout;
    }

    private authorization(): Record<string, string> {
        return {Authorization: `Bearer ${this.apiKey}`};
    }

    private async answerOf<T>(response: Response): Promise<T> {
        const answer = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) {
            throw new Error(`Image generation failed (${response.status}): ${reasonOf(answer)}`);
        }
        return answer as T;
    }
}

/** Dashscope writes a resolution as 1328*1328 where the other vendors write 1328x1328. */
export function pixelsOf(size: string): string {
    return size.replace('*', 'x');
}

/** Dashscope names the reason at the top of its answer, ark wraps it in an error object. */
function reasonOf(answer: unknown): string {
    const body = (answer ?? {}) as {message?: string; code?: string; error?: {message?: string; code?: string}};
    return body.error?.message || body.message || body.error?.code || body.code || 'no reason given';
}
