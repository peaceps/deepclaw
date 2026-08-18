import { imageExtensionOf, newImageRef, type LLMTaskOutput } from "@deepclaw/core";
import { FileStore, FileUtils, ImageStore } from "@deepclaw/node-utils";
import { i18nInstance } from "@deepclaw/i18n";

const OUTPUT_LENGTH_LIMIT = 1500;

/** More files than this in one output is a folder, and a folder is not a hand over. */
export const MAX_GENERATED_FILES = 10;

/**
 * A report too long to carry around is kept as a file of its own and read back when someone opens
 * it, so what stays on the task is the reference rather than the whole of it.
 */
export function fileAwayOutput(
    output: NonNullable<LLMTaskOutput>, folder: string, name: string
) {
    const outputType = output.type;
    if (outputType === 'binary' || output.content.length > OUTPUT_LENGTH_LIMIT) {
        const content = outputType === 'binary' ? Buffer.from(output.content, 'base64')
            : output.content;
        const ext = output.ext || getOutputExt(outputType);
        const path = FileUtils.writeFile(`${folder}/${name}.${ext}`, content);
        output.content = '<Content saved to file>';
        output.path = FileStore.urlOf(path);
    }
}

/**
 * A file a task produced lies where only the agent can reach it, so a path to it in the output is
 * a dead end for the user. Linked from the folder the work of that project is handed over in, the
 * file becomes something they can just click, and a picture is shown in the output instead.
 */
export function publishGeneratedFiles(
    output: NonNullable<LLMTaskOutput>, files: string[], folder: string, imageOwner: string
): {published: string[], skipped: string[]} {
    // Bytes have no room for a link, so a binary output has nowhere to hand a file over from.
    if (output.type === 'binary') {
        return {published: [], skipped: files};
    }
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
        try {
            lines.push(lineOf(output.type, file, folder, names, imageOwner));
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
    outputType: NonNullable<LLMTaskOutput>['type'], file: string, folder: string,
    taken: Set<string>, imageOwner: string
): string {
    const inPlace = pathInFolder(file, folder);
    const base = FileUtils.sanitizeFileName(baseName(inPlace ?? file));
    const extension = imageExtensionOf(base);
    if (outputType === 'markdown' && extension) {
        const bytes = FileUtils.readBuffer(file);
        return `- ![${base}](${newImageRef(ImageStore.save(bytes, extension, imageOwner))})`;
    }
    // A file written where the hand over lives is handed over as it lies: a copy beside itself
    // is a second file to keep in step with the first.
    if (inPlace) {
        if (!FileUtils.isFile(file)) {
            throw new Error(`${file} is no file to hand over.`);
        }
        return linkOf(outputType, base, FileStore.urlOf(inPlace));
    }
    const bytes = FileUtils.readBuffer(file);
    const name = freeName(base, file, bytes, folder, taken);
    const copied = FileUtils.writeFile(`${folder}/${name}`, bytes);
    return linkOf(outputType, name, FileStore.urlOf(copied));
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
    return outputType === 'markdown' ? `- [${name}](${url})` : `- ${name}: ${url}`;
}

/**
 * The path of a file that already lies in the folder the hand over goes to, written the way that
 * folder names it, or null for a file from anywhere else. A relative path is read against the data
 * root rather than against the folder, which is where the agent read it from too.
 */
function pathInFolder(file: string, folder: string): string | null {
    const path = FileUtils.getAbsolutePath(file);
    if (!FileUtils.isPathInside(folder, path)) {
        return null;
    }
    const inside = path.slice(FileUtils.getAbsolutePath(folder).length + 1);
    return inside ? `${folder}/${inside}` : null;
}

function baseName(file: string): string {
    return file.split(/[\\/]/).filter(Boolean).pop() || 'file';
}

/**
 * Two files can be named alike, and the later one must not bury the earlier: neither within one
 * hand over nor across the runs that filed into the same folder before it. What a name comes down
 * to on disk is what has to be kept apart here, since two names that differ only in a character a
 * path cannot carry are one file once they are written. The same file handed over twice keeps its
 * name, there is nothing of it to lose.
 */
function freeName(
    base: string, file: string, bytes: Buffer, folder: string, taken: Set<string>
): string {
    const name = taken.has(base) || buries(`${folder}/${base}`, bytes)
        ? `${FileUtils.hashString(file, 6)}-${base}` : base;
    taken.add(name);
    return name;
}

function buries(path: string, bytes: Buffer): boolean {
    try {
        return !FileUtils.readBuffer(path).equals(bytes);
    } catch {
        return false;
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
