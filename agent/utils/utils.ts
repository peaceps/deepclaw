import { MessageParam, ContentBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages/messages.js';


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

export function normalizeMessages(messages: MessageParam[]): MessageParam[] {
    const cleaned: MessageParam[] = [];
  
    // ===== 1. 清理 content =====
    for (const msg of messages) {
      const clean: MessageParam = { role: msg.role, content: '' };
  
      if (typeof msg.content === 'string') {
        clean.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        clean.content = msg.content
          .filter((block): block is ContentBlock => typeof block === 'object' && block !== null)
          .map(block => {
            const filtered: ContentBlock = {} as ContentBlock;
            for (const [k, v] of Object.entries(block)) {
              if (!k.startsWith('_')) {
                filtered[k as keyof ContentBlock] = v;
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
          if (
            typeof block === 'object' &&
            block?.type === 'tool_result' &&
            block.tool_use_id
          ) {
            existingResults.add(block.tool_use_id);
          }
        }
      }
    }
  
    // ===== 3. 补缺失的 tool_result =====
    const extraMessages: MessageParam[] = [];
  
    for (const msg of cleaned) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
  
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          block?.type === 'tool_use' &&
          block.id &&
          !existingResults.has(block.id)
        ) {
          extraMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: block.id,
                content: '(cancelled)',
              },
            ],
          });
        }
      }
    }
  
    cleaned.push(...extraMessages);
  
    // ===== 4. 合并连续相同 role =====
    if (cleaned.length === 0) return cleaned;
  
    const merged: MessageParam[] = [cleaned[0]!];
  
    for (const msg of cleaned.slice(1)) {
      const last = merged[merged.length - 1]!;
  
      if (msg.role === last.role) {
        const normalizeToBlocks = (content: MessageParam['content']): ContentBlock[] => {
          if (Array.isArray(content)) return content as ContentBlock[];
          return [{ type: 'text', text: String(content) } as TextBlock];
        };
  
        const prevContent = normalizeToBlocks(last.content);
        const currContent = normalizeToBlocks(msg.content);
  
        last.content = [...prevContent, ...currContent];
      } else {
        merged.push(msg);
      }
    }
  
    return merged;
  }