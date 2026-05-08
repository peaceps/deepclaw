export function formatLLMText(text: string): string {
    return text.replace(/\r\n/g, '\n').trimEnd();
}
