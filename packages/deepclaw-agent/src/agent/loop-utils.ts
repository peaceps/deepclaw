import type { LLMTaskOutput } from "@deepclaw/core";
import { FileUtils } from "@deepclaw/node-utils";
import { i18nInstance } from "@deepclaw/i18n";
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

/**
 * A file a task produced lies where only the agent can reach it, so a path to it in the output is
 * a dead end for the user. Copied beside the output and linked from it, the file becomes something
 * they can just click.
 */
export function publishGeneratedFiles(
    id: string, output: NonNullable<LLMTaskOutput>, title: string,
    files: string[], targetFolder: string
): {published: string[], skipped: string[]} {
    // Bytes have no room for a link, and without a public folder there is nowhere to copy to.
    if (output.type === 'binary' || !FileUtils.exists(PUBLIC)) {
        return {published: [], skipped: files};
    }
    const folder = `${targetFolder}/${id}/${FileUtils.hashString(title)}`;
    const published: string[] = [];
    const skipped: string[] = [];
    const links: string[] = [];
    const names = new Set<string>();
    for (const file of new Set(files)) {
        // Everything the agent can read is not what the browser may be handed: only the workspace.
        if (!FileUtils.isPathInWorkspace(file)) {
            skipped.push(file);
            continue;
        }
        const name = freeName(file, names);
        try {
            const copied = FileUtils.writeFile(`${folder}/${name}`, FileUtils.readBuffer(file));
            links.push(linkOf(output.type, name, `/${copied.substring(PUBLIC.length + 1)}`));
            published.push(file);
        } catch {
            // A folder, a file that is not there, a file that cannot be read: none to hand over.
            skipped.push(file);
        }
    }
    if (links.length) {
        const headline = headlineOf(output.type);
        output.content = `${output.content}\n\n${headline}\n${links.join('\n')}`;
    }
    return {published, skipped};
}

function headlineOf(outputType: NonNullable<LLMTaskOutput>['type']): string {
    const headline = i18nInstance.t('agent.tools.project.output.generatedFiles');
    return outputType === 'markdown' ? `## ${headline}` : `${headline}:`;
}

function linkOf(outputType: NonNullable<LLMTaskOutput>['type'], name: string, url: string): string {
    return outputType === 'markdown' ? `- [${name}](${url})` : `- ${name}: ${url}`;
}

/** Two files of one task can be named alike, and the later one must not bury the earlier. */
function freeName(file: string, taken: Set<string>): string {
    const base = file.split(/[\\/]/).filter(Boolean).pop() || 'file';
    const name = taken.has(base) ? `${FileUtils.hashString(file, 6)}-${base}` : base;
    taken.add(name);
    return name;
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
