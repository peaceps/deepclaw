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

/**
 * The clipboard, by whichever way this page has to it. The one browsers offer now is only there in
 * a secure context, which the app read over http from a phone on the same network is not, and there
 * the old trick of selecting a field nobody sees is the only way left.
 */
export async function copyText(text: string): Promise<void> {
    if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const field = document.createElement('textarea');
    field.value = text;
    // Off the screen rather than hidden: a field that is not displayed has nothing to select, and
    // one the page can scroll to would take the view with it.
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    document.body.appendChild(field);
    field.select();
    try {
        if (!document.execCommand('copy')) {
            throw new Error('The browser would not copy the selection.');
        }
    } finally {
        document.body.removeChild(field);
    }
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
