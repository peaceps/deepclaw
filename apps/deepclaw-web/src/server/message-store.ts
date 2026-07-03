import fs from 'fs';
import path from 'path';

const MESSAGES_DIR = path.join(process.cwd(), '.deepclaw-web', 'messages');

function getFilePath(chatKey: string): string {
    // Sanitize chatKey to be filesystem-safe
    const safe = chatKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(MESSAGES_DIR, `${safe}.json`);
}

function ensureDir(): void {
    if (!fs.existsSync(MESSAGES_DIR)) {
        fs.mkdirSync(MESSAGES_DIR, { recursive: true });
    }
}

export function loadMessages(chatKey: string): MessageRecord[] {
    try {
        const filePath = getFilePath(chatKey);
        if (!fs.existsSync(filePath)) return [];
        const content = fs.readFileSync(filePath, 'utf-8');
        const messages = JSON.parse(content);
        return Array.isArray(messages) ? messages : [];
    } catch {
        return [];
    }
}

export function appendMessage(chatKey: string, message: MessageRecord): void {
    ensureDir();
    const messages = loadMessages(chatKey);
    messages.push(message);
    const filePath = getFilePath(chatKey);
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
}

export type MessageRecord = {
    id: string;
    agentId: string;
    content: string;
    type: 'user' | 'agent';
    timestamp: string;
};
