import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

/** How much of the end of a file is read at once when only its last lines are wanted. */
const TAIL_BLOCK_BYTES = 64 * 1024;

/**
 * How many bytes a read of the last lines may take, whatever the count asked for comes to.
 *
 * A count of lines is not a bound on anything when a line has no bound: a record of runs that each
 * wrote a page of prose runs to tens of kilobytes a line, and the same five thousand lines that are
 * a megabyte in one file are hundreds of megabytes in another. What the bytes then cost is more than
 * themselves, and it is spent on the machine this whole scheme exists to protect, since what usually
 * breaks the writing of such a file is a disk with nothing left on it.
 *
 * More than themselves by some four times over, this being a bound on what is read and not on what
 * is held. A read that reaches it holds four of itself at once: the blocks walked back over, the
 * buffer they are joined into, the string that decodes to, and the lines that splits into. The
 * first two are the bytes exactly; the last two are the bytes again where the content is ascii and
 * a string can be kept to a byte a character, and up to twice that where one character outside
 * latin-1 anywhere in the file -- a single chinese word will do -- makes the whole string two-byte.
 * Thirty two megabytes read is therefore something like a hundred and fifty held, and what is held
 * is what the machine being protected feels.
 *
 * The figure stays where it is regardless. It is a ceiling no ordinary record comes near, five
 * thousand runs signing off in a sentence being a megabyte of them, so lowering it until the
 * arithmetic came out at the name would buy that headroom by cutting how far back the few records
 * that do reach it can be read.
 *
 * So the count is what is wanted and this is what is affordable, and a read that reaches this stops
 * on the last whole line it has. A caller asking for lines it does not get is a caller carrying less
 * of a very fat record than it meant to, which is the loss worth taking against not running at all.
 */
const TAIL_BUDGET_BYTES = 32 * 1024 * 1024;

const LINE_BREAK = 0x0a;

export class FileUtils {

    /** A moment as a name a file or a folder can carry, which sorts the way the clock ran. */
    public static timestamp(): string {
        return new Date().toISOString().replace(/[\-TZ\.:]/g, '');
    }

    public static wrapTimestamp(file: string): string {
        const [name, ext = 'log'] = file.split('.');
        return `${name}_${this.timestamp()}.${ext}`;
    }

    public static hashString(text: string | Buffer, length: number = 16): string {
        return createHash('sha256').update(text).digest('hex').slice(0, length);
    }

    public static exists(filePath: string): boolean {
        return fs.existsSync(this.getAbsolutePath(filePath));
    }

    public static readFile(filePath: string): string {
        const name = this.sanitizeFileName(filePath);
        const absolutePath = this.getAbsolutePath(name);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File ${filePath} not found.`);
        }
        return fs.readFileSync(absolutePath, 'utf8');
    }

    /**
     * The last lines of a file, without reading what comes before them.
     *
     * Which is the whole point: a record that is only ever appended to and only ever read from the
     * end has no size at which reading all of it to keep the last forty is reasonable, and a file
     * that has grown to gigabytes is one a startup cannot afford to hold in memory even for the
     * moment it takes to throw the front of it away.
     *
     * Read backwards a block at a time until one more line break has gone by than there are lines
     * wanted -- one more, because the break before a line is the only thing that says the line is
     * whole rather than the tail of a longer one -- or until `TAIL_BUDGET_BYTES` have been read,
     * whichever comes first. Blank lines are dropped, so a record ending in a break, as an appended
     * one does, does not answer with an empty last line.
     *
     * Whatever stopped the walk, it stopped somewhere in the middle of the file rather than at a
     * line, so what the read begins with is the tail of a line rather than a line. It goes: in the
     * ordinary case it would have gone anyway, there being more whole lines behind it than were
     * asked for, and in the case the budget cut short it is the difference between the lines being
     * whole and the oldest of them being half of one.
     */
    public static readTailLines(filePath: string, count: number): string[] {
        if (count <= 0) {
            return [];
        }
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(filePath));
        if (!fs.existsSync(absolutePath)) {
            return [];
        }
        const fd = fs.openSync(absolutePath, 'r');
        try {
            let position = fs.fstatSync(fd).size;
            const blocks: Buffer[] = [];
            let breaks = 0;
            let read = 0;
            while (position > 0 && breaks <= count && read < TAIL_BUDGET_BYTES) {
                const size = Math.min(TAIL_BLOCK_BYTES, position);
                position -= size;
                const block = Buffer.alloc(size);
                fs.readSync(fd, block, 0, size, position);
                // Kept whole and decoded at the end: a character of utf-8 can straddle the seam
                // between two blocks, and each half of one decodes to nothing either side of it.
                blocks.unshift(block);
                read += size;
                for (let at = block.indexOf(LINE_BREAK); at !== -1; at = block.indexOf(LINE_BREAK, at + 1)) {
                    breaks++;
                }
            }
            const lines = Buffer.concat(blocks).toString('utf8').split('\n');
            if (position > 0) {
                lines.shift();
            }
            return lines.filter(Boolean).slice(-count);
        } finally {
            fs.closeSync(fd);
        }
    }

    /**
     * Whether the path is a link rather than the thing itself, which is asked of a link left over
     * by somebody else: it is deleted for being a link, and what it points at stays whoever's it is.
     * A link leading nowhere is still one, so this is asked of the path and not of its target.
     */
    public static isLink(filePath: string): boolean {
        try {
            return fs.lstatSync(this.getAbsolutePath(this.sanitizeFileName(filePath))).isSymbolicLink();
        } catch {
            return false;
        }
    }

    /** Where a link leads, for saying so in a log. Null for what is no link, or for an unreadable one. */
    public static linkTarget(filePath: string): string | null {
        try {
            return fs.readlinkSync(this.getAbsolutePath(this.sanitizeFileName(filePath)));
        } catch {
            return null;
        }
    }

    /** A folder exists as much as a file does, and only one of the two can be handed over. */
    public static isFile(filePath: string): boolean {
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(filePath));
        return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    }

    /**
     * The size of a file, or null for what is no file to read. Two files that differ in it differ,
     * and that is an answer without holding either of them in memory.
     */
    public static sizeOf(filePath: string): number | null {
        try {
            const stat = fs.statSync(this.getAbsolutePath(this.sanitizeFileName(filePath)));
            return stat.isFile() ? stat.size : null;
        } catch {
            return null;
        }
    }

    public static readBuffer(filePath: string): Buffer {
        const name = this.sanitizeFileName(filePath);
        const absolutePath = this.getAbsolutePath(name);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File ${filePath} not found.`);
        }
        return fs.readFileSync(absolutePath);
    }

    public static readDir(
        dirPath: string, fileToRead?: ((fileName: string) => string)
    ): {[key: string]: {dir: string, content: string}} {
        const files: {[key: string]: {dir: string, content: string}} = {};
        const name = this.sanitizeFileName(dirPath);
        dirPath = this.getAbsolutePath(name);
        if (fs.existsSync(dirPath)) {
            for (const subDir of fs.readdirSync(dirPath)) {
                const filePath = fileToRead ? fileToRead(subDir) : subDir;
                if (!filePath) continue;
                try {
                    files[filePath] = {dir: subDir, content: this.readFile(`${dirPath}/${filePath}`)};
                } catch {
                    // TODO: Handle error
                    continue;
                }
            }
        }
        return files;
    }

    public static writeFile(filePath: string, content: string | Buffer): string {
        const name = this.sanitizeFileName(filePath);
        const absolutePath = this.getAbsolutePath(name);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
        return name;
    }

    public static appendFile(filePath: string, content: string): void {
        const name = this.sanitizeFileName(filePath);
        const absolutePath = this.getAbsolutePath(name);
        this.ensureFolderExist(absolutePath);
        fs.appendFileSync(absolutePath, content, 'utf8');
    }

    public static deleteFile(filePath: string): void {
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(filePath));
        if (fs.existsSync(absolutePath)) {
            fs.rmSync(absolutePath, {force: true});
        }
    }

    /**
     * A link that leads nowhere is still a link to delete, and asking whether it exists is asking
     * after what it points at. Nothing is asked: a path that is not there is what force is for.
     */
    public static deleteDir(filePath: string): void {
        fs.rmSync(this.getAbsolutePath(this.sanitizeFileName(filePath)), {force: true, recursive: true});
    }

    /**
     * The files directly under this one, by name and nothing else. Which is the difference from
     * `readDir`: a folder of files too big to want in memory can still be asked what it holds.
     */
    public static listFiles(dirPath: string): string[] {
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(dirPath));
        if (!fs.existsSync(absolutePath)) {
            return [];
        }
        return fs.readdirSync(absolutePath, {withFileTypes: true})
            .filter(entry => entry.isFile())
            .map(entry => entry.name);
    }

    /** The folders directly under this one, by name. A path that is not there holds none. */
    public static listDirs(dirPath: string): string[] {
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(dirPath));
        if (!fs.existsSync(absolutePath)) {
            return [];
        }
        return fs.readdirSync(absolutePath, {withFileTypes: true})
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    }

    /**
     * Moves a file or a whole folder, making the parent of the target first. A path that is not
     * there is nothing to move, so asking twice costs no more than asking once.
     */
    public static movePath(from: string, to: string): boolean {
        const source = this.getAbsolutePath(this.sanitizeFileName(from));
        if (!fs.existsSync(source)) {
            return false;
        }
        const target = this.getAbsolutePath(this.sanitizeFileName(to));
        this.ensureFolderExist(target);
        fs.renameSync(source, target);
        return true;
    }

    public static findLatest(folder: string, subFile: string = ''): string {
        const fullFolder = this.getAbsolutePath(folder);
        if (!fs.existsSync(fullFolder)) {
            return '';
        }
        const files = fs.readdirSync(fullFolder);
        const sorted = files.map(file => {
            const filePath = path.join(fullFolder, file + (!subFile ? '' : `/${subFile}`));
            const stat = !fs.existsSync(filePath) ? null : fs.statSync(filePath);
            return { file, stat };
        }).filter(item => item.stat && item.stat.isFile()).sort((a, b) => b.stat!.mtimeMs - a.stat!.mtimeMs);
        return sorted[0]?.file || '';
    }

    /**
     * Cuts a folder back to the newest so many files, by when each was last written, and never
     * raises: what it is asked for is room before something is written, and a caller that cannot
     * make room is still a caller with something to write. It is called from inside the logger, so
     * a throw from here would come out of whatever line was being logged -- most often a line in a
     * catch block, taking the place of the error it was reporting.
     *
     * Which is also why a file that will not go is passed over rather than taken as a failure: on
     * windows the file another process has open cannot be deleted at all, and stopping at the first
     * of those would leave everything older than it there for good. `keep` is for saying so before
     * the attempt where the caller knows; those files count towards the limit and are never thrown
     * away, so a folder of nothing but kept files simply stays as it is. A `keep` that raises rather
     * than answers is read as a yes, which is both halves of what this promises: no telling whether
     * a file is wanted is no reason to delete it, and none to raise out of here either.
     */
    public static enforceFileCountLimit(
        folder: string, limit: number, keep?: (fileName: string) => boolean
    ): void {
        const files = this.filesByAge(this.getAbsolutePath(folder));
        const removeCount = files.length - limit;
        if (removeCount <= 0) {
            return;
        }

        for (const file of files.slice(0, removeCount)) {
            try {
                if (keep?.(file.name)) {
                    continue;
                }
                fs.rmSync(file.filePath);
            } catch {
                // It is wanted, somebody is writing it, it has already gone, or there was no
                // telling which of those. Either way, not this one.
            }
        }
    }

    /** The files of a folder, oldest first. A folder there is no reading holds none of them. */
    private static filesByAge(
        fullPath: string
    ): {name: string, filePath: string, mtimeMs: number}[] {
        try {
            return fs.readdirSync(fullPath).flatMap(name => {
                const filePath = path.join(fullPath, name);
                try {
                    const stat = fs.statSync(filePath);
                    return stat.isFile() ? [{name, filePath, mtimeMs: stat.mtimeMs}] : [];
                } catch {
                    // Gone between the folder being read and the ask about it: one file fewer.
                    return [];
                }
            }).sort((one, other) => one.mtimeMs - other.mtimeMs);
        } catch {
            // Not there, or not ours to read. Neither is a folder to cut anything back in.
            return [];
        }
    }

    public static isPathInWorkspace(filePath: string): boolean {
        const targetPath = this.getAbsolutePath(filePath);
        if (targetPath.startsWith(this.formatSlash(`${this.getTmpDir()}/`))) {
            return true;
        }
        return this.isPathInside(this.getWorkingDir(), filePath);
    }

    public static isPathInside(baseDir: string, targetPath: string): boolean {
        let base = this.getAbsolutePath(baseDir);
        let target = this.formatSlash(path.resolve(base, this.formatSlash(targetPath)));
        if (process.platform === 'win32' || process.platform === 'darwin') {
            base = base.toLowerCase();
            target = target.toLowerCase();
        }
        const basePrefix = base.endsWith('/') ? base : `${base}/`;
        return target === base || target.startsWith(basePrefix);
    }

    /**
     * Lays a shipped resource down where the data root expects it, without ever writing over what
     * is already there: whatever the user has made of a resource is theirs.
     *
     * A folder of them is filled in one entry at a time rather than skipped whole. Shipped as one
     * folder, the skills are added to release by release, and an install that has the folder from
     * an older build would otherwise never see a single one of them again.
     *
     * Which entries have been laid down is written beside that folder, and one written there is
     * never laid down again. This runs on every start, so with nothing keeping that count a skill
     * the user removed would be back by the next one, and removing a skill is something this app
     * does properly, down to the lock entries the installer cli leaves behind. The record is only
     * ever added to: an entry of it that is missing from disk is missing because somebody took it,
     * which is the whole of what the record is for.
     *
     * The first start after this record appears has none to read, so everything shipped is new to
     * it once, and a skill removed before that start comes back for it. Nothing on disk tells that
     * case from an install that never had the skill at all.
     */
    public static copyResource(fromDir: string, targetName: string, toDir: string = ''): void {
        const targetPath = toDir ? `${toDir}/${targetName}` : targetName;
        const destination = path.resolve(this.getWorkingDir(), targetPath);
        const source = this.resourceOf(fromDir, targetName);
        if (!source) {
            return;
        }
        if (!fs.existsSync(destination)) {
            fs.cpSync(source, destination, { recursive: true });
            if (fs.statSync(source).isDirectory()) {
                this.recordPlanted(destination, fs.readdirSync(source));
            }
            return;
        }
        if (!fs.statSync(source).isDirectory() || !fs.statSync(destination).isDirectory()) {
            return;
        }
        const planted = this.readPlanted(destination);
        const laying = fs.readdirSync(source).filter(entry => !planted.includes(entry));
        if (laying.length === 0) {
            return;
        }
        for (const entry of laying) {
            const entryDestination = path.join(destination, entry);
            if (!fs.existsSync(entryDestination)) {
                fs.cpSync(path.join(source, entry), entryDestination, { recursive: true });
            }
        }
        this.recordPlanted(destination, [...planted, ...laying]);
    }

    /**
     * Where the entries laid down in a folder are counted, beside the folder rather than inside
     * it: a file among the skills is a folder short of being read as a skill of its own.
     */
    private static plantedRecord(destination: string): string {
        return path.join(path.dirname(destination), `.${path.basename(destination)}.planted`);
    }

    private static readPlanted(destination: string): string[] {
        try {
            const record = this.plantedRecord(destination);
            if (!fs.existsSync(record)) {
                return [];
            }
            const planted: unknown = JSON.parse(fs.readFileSync(record, 'utf-8'));
            return Array.isArray(planted) ? planted.filter(entry => typeof entry === 'string') : [];
        } catch {
            // A record that cannot be read is a record of nothing. It costs the entries of a folder
            // being laid down once more, which is the cost of the very first start either way.
            return [];
        }
    }

    private static recordPlanted(destination: string, entries: string[]): void {
        try {
            fs.writeFileSync(this.plantedRecord(destination), JSON.stringify(entries, null, 2));
        } catch {
            // Nothing here is worth failing a start over: a count that was not written is a folder
            // laid down again next time, which is what happened before there was one to write.
        }
    }

    /**
     * A checkout keeps its resources beside the module that asks for them. A packaged build
     * cannot: the code it asks from is bundled somewhere else entirely, so the launcher names
     * the folder the resources were shipped in.
     */
    private static resourceOf(fromDir: string, targetName: string): string | null {
        const shipped = process.env['DEEPCLAW_RESOURCES'];
        const candidates = [
            ...(shipped ? [path.join(shipped, targetName)] : []),
            path.join(fromDir, 'resources', targetName),
            path.join(fromDir, '..', 'resources', targetName),
        ];
        return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
    }

    /**
     * The path a name really means, since a relative one is read against the data root. A
     * backslash in it is a separator before anything is resolved rather than after: written the
     * other way round, a step out of a folder would survive the resolving as two dots of a name
     * and become a step again on the way to disk, where whoever allowed the name never saw it.
     */
    public static getAbsolutePath(relativePath: string): string {
        const named = this.formatSlash(relativePath);
        return this.formatSlash(path.isAbsolute(named) ? named : path.resolve(this.getWorkingDir(), named));
    }

    public static ensureFileExist(filePath: string, content: string = ''): void {
        const absolutePath = this.getAbsolutePath(filePath);
        if (!fs.existsSync(absolutePath)) {
            this.writeFile(absolutePath, content);
        }
    }

    private static ensureFolderExist(pathStr: string): void {
        this.getAbsolutePath(pathStr).split('/').reduce((pre, next) => {
            if (!pre) return !next ? '/' : next;
            if (!fs.existsSync(pre)) fs.mkdirSync(pre);
            return `${pre}/${next}`;
        }, '');
    }

    private static formatSlash(pathStr: string): string {
        return pathStr.replace(/\\/g, '/').replace(/\/\//g, '/');
    }

    /**
     * The name a path really lands under. Whoever names a file to the user has to name the same one
     * it was written as, so the answer to that is public rather than a secret of writing a file.
     */
    public static sanitizeFileName(fileName: string, allowFolder: boolean = true): string {
        const index = fileName.indexOf(':');
        const prefix = index !== -1 ? fileName.slice(0, index + 1) : '';
        const suffix = index !== -1 ? fileName.slice(index + 1) : fileName;
        const reg = allowFolder ? /[\*?<>&|:'"%^@`~]/g : /[\*?<>&|:'"%^@`~/\.]/g;
        return prefix + this.formatSlash(suffix).replace(reg, '_');
    }

    /** Everything an agent reads or writes lives here, whatever the process was started from. */
    public static getWorkingDir(): string {
        return process.env['DEEPCLAW_HOME'] || process.cwd();
    }

    public static getTmpDir(): string {
        return `${process.env['DEEPCLAW_SUBLOOP_HOME'] || os.tmpdir()}/.deepclaw`;
    }
}
