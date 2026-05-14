import {ThinkingMessage, ThinkingContent} from './anthropic-llm.js';

export function normalizeMessages(messages: ThinkingMessage[]): ThinkingMessage[] {
    const cleaned: ThinkingMessage[] = [];
        
    // ===== 1. 清理 content =====
    for (const msg of messages) {
        const clean: ThinkingMessage = { role: msg.role as 'assistant' | 'user', content: '' };

        if (typeof msg.content === 'string') {
            clean.content = msg.content;
        } else if (Array.isArray(msg.content)) {
            clean.content = msg.content
                .filter((block: ThinkingContent) => typeof block === 'object' && block !== null)
                .map((block: ThinkingContent) => {
                    const filtered = {} as ThinkingContent;
                    for (const [k, v] of Object.entries(block)) {
                        if (!k.startsWith('_')) {
                            filtered[k as keyof ThinkingContent] = v as any;
                        }
                    }
                    return filtered;
                });
        } else {
            clean.content = msg.content ?? '';
        }
        cleaned.push(clean);
    }
    
    // ===== 2. 收集已有 tool_result =====
    const existingResults = new Set<string>();
    for (const msg of cleaned) {
        if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (typeof block === 'object' && block.type === 'tool_result' && block.tool_use_id) {
                    existingResults.add(block.tool_use_id);
                }
            }
        }
    }
    
    // ===== 3. 补缺失的 tool_result =====
    const extraMessages: ThinkingMessage[] = [];
    for (const msg of cleaned) {
        if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (typeof block === 'object' && block.type === 'tool_use' && block.id && !existingResults.has(block.id)) {
                extraMessages.push({
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: block.id, content: '(cancelled)'}],
                });
            }
        }
    }
    cleaned.push(...extraMessages);
    
    // ===== 4. 合并连续相同 role =====
    if (cleaned.length === 0) return cleaned;
    
    const merged: ThinkingMessage[] = [cleaned[0]!];
    for (const msg of cleaned.slice(1)) {
        const last = merged[merged.length - 1]!;
    
        if (msg.role === last.role) {
            const prevContent = normalizeToBlocks(last.content);
            const currContent = normalizeToBlocks(msg.content);
            last.content = [...prevContent, ...currContent];
        } else {
            merged.push(msg);
        }
    }
    
    return merged;
}

function normalizeToBlocks(content: string | ThinkingContent[]): ThinkingContent[] {
    return Array.isArray(content) ? content : [{ type: 'text', text: content }];
}
