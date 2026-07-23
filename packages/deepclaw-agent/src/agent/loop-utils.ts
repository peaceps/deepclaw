import type { LLMTaskOutput } from "@deepclaw/core";
import { FileUtils } from "@deepclaw/node-utils";
import { PUBLIC } from "./paths";

const OUTPUT_LENGTH_LIMIT = 1500;

export function saveToPublic(
    id: string, output: NonNullable<LLMTaskOutput>, title: string, targetFolder: string
) {
    if (!FileUtils.exists(PUBLIC)) return;
    const outputType = output.type;
    if (outputType === 'binary' || output.content.length > OUTPUT_LENGTH_LIMIT) {
        const content = outputType === 'binary' ? Buffer.from(output.content, 'base64')
            : output.content;
        const ext = output.ext || getOutputExt(outputType);
        const path = FileUtils.writeFile(
            `${targetFolder}/${id}/${FileUtils.hashString(title)}.${ext}`, content
        );
        output.content = '<Content saved to file>';
        output.path = `/${path.substring(PUBLIC.length + 1)}`;
    }
}

function getOutputExt(outputType: NonNullable<LLMTaskOutput>['type']): string {
    switch (outputType) {
        case 'text':
            return 'txt';
        case 'markdown':
            return 'md'
        default:
            return 'out';
    }
}
