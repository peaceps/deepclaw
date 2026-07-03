import { loadMessages, appendMessage, type MessageRecord } from '@/server/message-store';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const chatKey = url.searchParams.get('chatKey');

    if (!chatKey) {
        return Response.json({ error: 'chatKey is required' }, { status: 400 });
    }

    const messages = loadMessages(chatKey);
    return Response.json({ messages });
}

export async function POST(request: Request) {
    const body = await request.json() as Partial<MessageRecord> & { chatKey?: string };
    const { chatKey, ...message } = body;

    if (!chatKey || !message.id || !message.type || !message.agentId || message.timestamp === undefined) {
        return Response.json({ error: 'chatKey, id, type, agentId, timestamp are required' }, { status: 400 });
    }

    appendMessage(chatKey, message as MessageRecord);
    return Response.json({ ok: true });
}
