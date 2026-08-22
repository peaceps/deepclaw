import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

export class FileUtils {

    public static wrapTimestamp(file: string): string {
        const [name, ext = 'log'] = file.split('.');
        return `${name}_${new Date().toISOString().replace(/[\-TZ\.:]/g, '')}.${ext}`;
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

    public static enforceFileCountLimit(folder: string, limit: number): void {
        const fullPath = this.getAbsolutePath(folder);
        if (!fs.existsSync(fullPath)) {
            return;
        }

        const files = fs.readdirSync(fullPath).map(file => {
            const filePath = path.join(fullPath, file);
            const stat = fs.statSync(filePath);
            return { filePath, stat };
        }).filter(item => item.stat.isFile()).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

        const removeCount = files.length - limit;
        if (removeCount <= 0) {
            return;
        }

        for (const file of files.slice(0, removeCount)) {
            fs.rmSync(file.filePath);
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

    public static copyResource(fromDir: string, targetName: string, toDir: string = ''): void {
        const targetPath = toDir ? `${toDir}/${targetName}` : targetName;
        const destination = path.resolve(this.getWorkingDir(), targetPath);
        if (!fs.existsSync(destination)) {
            const source = this.resourceOf(fromDir, targetName);
            if (source) {
                fs.cpSync(source, destination, { recursive: true });
            }
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
