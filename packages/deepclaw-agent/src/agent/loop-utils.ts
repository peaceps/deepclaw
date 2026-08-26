import { isImageName, type LLMTaskOutput } from "@deepclaw/core";
import { FileStore, FileUtils } from "@deepclaw/node-utils";
import { i18nInstance } from "@deepclaw/i18n";

const OUTPUT_LENGTH_LIMIT = 1500;

/**
 * How long an answer of a tool may be before it is filed away and comes back as a preview and a
 * path. It lives here rather than beside the filing itself because whoever builds an answer out of
 * things of any length has to keep under it: a tool that budgets what it carries has no other
 * number to budget against, and one that does not is answering with a preview of itself.
 */
export const TRUNCATE_THRESHOLD = 20000;

/**
 * How many bytes of utf-8 go to a token, taken low enough that no script comes out under.
 *
 * Utf-8 is a rough tokenizer wearing another hat. What makes a script expensive in tokens is much
 * what makes it expensive in bytes: latin text runs a byte to a character and about four characters
 * to a token, cyrillic and greek and hebrew and arabic run two bytes and about two characters, cjk
 * and thai and devanagari run three bytes and about one character. Three bytes to a token is
 * therefore a third to a half over the truth almost everywhere, and over is the side to be on.
 */
const BYTES_PER_TOKEN = 3;

/**
 * Roughly how many tokens a piece of text will come to, erring high.
 *
 * A guess, and deliberately a crude one -- no tokenizer is shipped here and the vendors do not
 * agree on theirs anyway. What it has to get right is the thing a count of characters gets badly
 * wrong: that the rate is not one rate. One number of characters over both chinese and english is
 * wrong by a factor of four on one of them, and which one depends on the conversation rather than
 * on anything anybody configured.
 *
 * Counted off the bytes rather than off a table of script ranges, which is the cheap way to have no
 * gaps. A table gets latin text exactly right and then quietly reads cyrillic or thai at a quarter
 * of what they cost, because those ranges are not in it -- and the one place an underestimate is
 * expensive is trimming a call down to fit a window, where reading a history as smaller than it is
 * means the call goes out too long anyway and the run has spent a refusal to learn nothing. Erring
 * a third high everywhere beats erring fourfold low on whichever script nobody thought of.
 *
 * Used only where nothing exact is available. What the model itself reports is exact and takes over.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN);
}

/** What is left where the content of an output was, once the content lies in a file of its own. */
const FILED_AWAY = '<Content saved to file>';

/** More files than this in one output is a folder, and a folder is not a hand over. */
export const MAX_GENERATED_FILES = 10;

/**
 * The ext of an output, worded once for the three tools that take one. Every tool of a run is read
 * on every turn of it, so a sentence standing in three of them is a sentence bought three times.
 */
export const EXT_DESCRIPTION =
    'The extension of the file a large content is filed into: "md" for markdown, "txt" for text, '
    + 'or what the content really is, e.g. "csv".';

/**
 * A report too long to carry around is kept as a file of its own and read back when someone opens
 * it, so what stays on the task is the reference rather than the whole of it. Filing away happens
 * once: the placeholder left in place of the report is far too short to be filed again.
 */
export function fileAwayOutput(
    output: NonNullable<LLMTaskOutput>, folder: string, name: string
) {
    if (output.content.length <= OUTPUT_LENGTH_LIMIT) {
        return;
    }
    const ext = output.ext || getOutputExt(output.type);
    const path = FileUtils.writeFile(`${folder}/${name}.${ext}`, output.content);
    output.content = FILED_AWAY;
    output.path = FileStore.urlOf(path);
}

/**
 * Bytes written into a tool call stay in the context of the run for as long as it lives, and base64
 * of a file runs a third longer than the file itself. What the work produced is written to disk and
 * handed over from there, so an output that is a file rather than words is turned away.
 */
export function requireReadableOutput(output: NonNullable<LLMTaskOutput>): void {
    if (output.type !== 'binary') {
        return;
    }
    throw new Error(`An output carries what the user reads, not the bytes of a file. Write the file
into the workspace, hand it over in generatedFiles, and say in the content what it holds.`);
}

/**
 * An output as it stands in the answer to a write of it, with the words of it left out: a run that
 * just handed a report over would read its own words back, and a handful of reports in one answer
 * crowd out everything else in it or have the whole answer truncated. One already filed away has
 * no words left in it to leave out, and a note in place of the little it does carry would only
 * make the answer longer than saying nothing.
 */
export function keptOutput(
    output: NonNullable<LLMTaskOutput>, kept: string
): NonNullable<LLMTaskOutput> {
    return output.path ? output : {...output, content: kept};
}

/**
 * A file a task produced lies where only the agent can reach it, so a path to it in the output is
 * a dead end for the user. Linked from the folder the work of that project is handed over in, the
 * file becomes something they can just click, and a picture is shown in the output instead.
 */
export function publishGeneratedFiles(
    output: NonNullable<LLMTaskOutput>, files: string[], folder: string
): {published: string[], skipped: string[]} {
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
            lines.push(handOver(output.type, file, folder, names));
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
 * Puts one file where the user can reach it and says how the output names it from there. Every
 * file of a run ends up in the same folder, a picture as much as a report: one place holds what
 * the work produced, and what the project is deleted with takes its pictures along.
 */
function handOver(
    outputType: NonNullable<LLMTaskOutput>['type'], file: string, folder: string, taken: Set<string>
): string {
    // A file written where the hand over lives is handed over as it lies: a copy beside itself
    // is a second file to keep in step with the first.
    const inPlace = pathInFolder(file, folder);
    if (inPlace) {
        if (!FileUtils.isFile(file)) {
            throw new Error(`${file} is no file to hand over.`);
        }
        return linkOf(outputType, baseName(inPlace), FileStore.urlOf(inPlace));
    }
    const bytes = FileUtils.readBuffer(file);
    const name = freeName(FileUtils.sanitizeFileName(baseName(file)), file, bytes, folder, taken);
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

/**
 * A picture is worth more shown than offered, and markdown is the only output that can show one:
 * a text output has nowhere to put a picture but a path.
 */
function linkOf(outputType: NonNullable<LLMTaskOutput>['type'], name: string, url: string): string {
    if (outputType !== 'markdown') {
        return `- ${name}: ${url}`;
    }
    // A bracket in the name of a file is where markdown reads the text of the link as ending.
    const text = name.replace(/[[\]]/g, '\\$&');
    return isImageName(name) ? `- ![${text}](${url})` : `- [${text}](${url})`;
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
    // What a run hands over can be a video, and two files that differ in size are told apart
    // without holding both of them in memory at once.
    const size = FileUtils.sizeOf(path);
    if (size === null) {
        return false;
    }
    if (size !== bytes.length) {
        return true;
    }
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
