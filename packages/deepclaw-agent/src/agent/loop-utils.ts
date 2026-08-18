import { imageExtensionOf, newImageRef, type LLMTaskOutput } from "@deepclaw/core";
import { FileUtils, ImageStore } from "@deepclaw/node-utils";
import { i18nInstance } from "@deepclaw/i18n";
import { PUBLIC } from "./paths";

const OUTPUT_LENGTH_LIMIT = 1500;

/** More files than this in one output is a folder, and a folder is not a hand over. */
export const MAX_GENERATED_FILES = 10;

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
 * they can just click, and a picture is shown in the output instead of linked under it.
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
    // The schema of the tool asks for the cap, only a well behaved model keeps to what it asks.
    const wanted = [...new Set(files)];
    const skipped: string[] = wanted.slice(MAX_GENERATED_FILES);
    const lines: string[] = [];
    const names = new Set<string>();
    for (const file of wanted.slice(0, MAX_GENERATED_FILES)) {
        // Everything the agent can read is not what the browser may be handed: only the workspace.
        if (!FileUtils.isPathInWorkspace(file)) {
            skipped.push(file);
            continue;
        }
        const name = freeName(file, names);
        try {
            lines.push(lineOf(output.type, id, folder, name, FileUtils.readBuffer(file)));
            published.push(file);
        } catch {
            // A folder, a file that is not there, a file that cannot be read: none to hand over.
            skipped.push(file);
        }
    }
    if (lines.length) {
        const headline = headlineOf(output.type);
        output.content = `${output.content}\n\n${headline}\n${lines.join('\n')}`;
    }
    return {published, skipped};
}

/**
 * A picture is worth more shown than offered: it goes into the store every picture of a chat
 * travels through, and the reference to it is what draws it where the output is read. Only a
 * markdown output can show one, a text output has nowhere to put a picture but a path.
 */
function lineOf(
    outputType: NonNullable<LLMTaskOutput>['type'], id: string, folder: string,
    name: string, bytes: Buffer
): string {
    const extension = imageExtensionOf(name);
    if (outputType === 'markdown' && extension) {
        return `- ![${name}](${newImageRef(ImageStore.save(bytes, extension, id))})`;
    }
    const copied = FileUtils.writeFile(`${folder}/${name}`, bytes);
    return linkOf(outputType, name, `/${copied.substring(PUBLIC.length + 1)}`);
}

/** What never reached the user has to be said, or the run carries on believing it was handed over. */
export function skippedFilesNote(skipped: string[]): string {
    if (!skipped.length) {
        return '';
    }
    return `

These files were not handed to the user: ${skipped.join(', ')}. Every one of them has to be a file
rather than a folder, has to lie inside the workspace, and at most ${MAX_GENERATED_FILES} of them go
out with one output. Copy what the user should get into the workspace first.`;
}

function headlineOf(outputType: NonNullable<LLMTaskOutput>['type']): string {
    const headline = i18nInstance.t('agent.tools.project.output.generatedFiles');
    return outputType === 'markdown' ? `## ${headline}` : `${headline}:`;
}

function linkOf(outputType: NonNullable<LLMTaskOutput>['type'], name: string, url: string): string {
    const href = url.split('/').map(encodeURIComponent).join('/');
    return outputType === 'markdown' ? `- [${name}](${href})` : `- ${name}: ${href}`;
}

/**
 * Two files of one task can be named alike, and the later one must not bury the earlier. What a
 * name comes down to on disk is what has to be kept apart here: two names that differ only in a
 * character a path cannot carry are one file once they are written, and one link either way.
 */
function freeName(file: string, taken: Set<string>): string {
    const base = FileUtils.sanitizeFileName(file.split(/[\\/]/).filter(Boolean).pop() || 'file');
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
