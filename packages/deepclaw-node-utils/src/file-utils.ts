import fs from 'fs';
import os from 'os';
import path from 'path';

export class FileUtils {

    public static wrapTimestamp(file: string): string {
        const [name, ext = 'log'] = file.split('.');
        return `${name}_${new Date().toISOString().replace(/[\-TZ\.:]/g, '')}.${ext}`;
    }

    public static readFile(filePath: string): string {
        const absolutePath = this.getAbsolutePath(filePath);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File ${filePath} not found.`);
        }
        return fs.readFileSync(absolutePath, 'utf8');
    }

    public static readDir(dirPath: string, fileToRead?: ((fileName: string) => string)): {[key: string]: string} {
        const files: {[key: string]: string} = {};
        dirPath = this.getAbsolutePath(dirPath);
        if (fs.existsSync(dirPath)) {
            for (const fileName of fs.readdirSync(dirPath)) {
                const filePath = fileToRead ? fileToRead(fileName) : fileName;
                if (!filePath) continue;
                try {
                    files[filePath] = this.readFile(`${dirPath}/${filePath}`);
                } catch {
                    // TODO: Handle error
                    continue;
                }
            }
        }
        return files;
    }

    public static writeFile(filePath: string, content: string): void {
        const absolutePath = this.getAbsolutePath(this.sanitizeFileName(filePath));
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
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
        let workspacePath = this.getAbsolutePath(this.getWorkingDir());
        let targetPath = this.getAbsolutePath(filePath);
        if (targetPath.startsWith(this.formatSlash(`${os.tmpdir()}/.deepclaw/`))) {
            return true;
        }
        if (process.platform === 'win32' || process.platform === 'darwin') {
            workspacePath = workspacePath.toLowerCase();
            targetPath = targetPath.toLowerCase();
        }
        const workspacePrefix = workspacePath.endsWith('/') ? workspacePath : `${workspacePath}/`;
        return targetPath === workspacePath || targetPath.startsWith(workspacePrefix);
    }

    public static copyResource(fromDir: string, fileName: string): void {
        const destination = path.resolve(this.getWorkingDir(), fileName);
        if (!fs.existsSync(destination)) {
            let source = path.join(fromDir, 'resources', fileName);
            if (!fs.existsSync(source)) {
                source = path.join(fromDir, '..', 'resources', fileName);
            }
            if (fs.existsSync(source)) {
                fs.cpSync(source, destination, { recursive: true });
            }
        }
    }

    private static getAbsolutePath(relativePath: string): string {
        return this.formatSlash(path.isAbsolute(relativePath) ? relativePath : path.resolve(this.getWorkingDir(), relativePath));
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

    private static sanitizeFileName(fileName: string, allowFolder: boolean = true): string {
        const index = fileName.indexOf(':');
        const prefix = index !== -1 ? fileName.slice(0, index + 1) : '';
        const suffix = index !== -1 ? fileName.slice(index + 1) : fileName;
        const reg = allowFolder ? /[\*?<>&|:'"%^@`~]/g : /[\*?<>&|:'"%^@`~/\.]/g;
        return prefix + this.formatSlash(suffix).replace(reg, '_');
    }

    private static getWorkingDir(): string {
        return process.env['DEEPCLAW_HOME'] || process.cwd();
    }
}
