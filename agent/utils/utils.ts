
export function extractText(content: any): string {
    if (!Array.isArray(content)) {
        return "";
    }
    const texts: string[] = [];
    for (const block of content) {
        const text = (block as any).text;

        if (text) {
            texts.push(text);
        }
    }
    return texts.join("\n").trim();
}