export async function fetchFile(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
    }
    return await response.text();
}

export function getFileNameFromPath(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() ?? '';
}

export function saveToFile(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
