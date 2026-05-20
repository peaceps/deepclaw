import fs from 'fs';
import path from 'path';

const SESSION_DIR = '.session';

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
                } catch (error) {
                    continue;
                }
            }
        }
        return files;
    }

    public static writeFile(filePath: string, content: string): void {
        const absolutePath = this.getAbsolutePath(filePath);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
    }

    public static writeFileToSession(parentSessionId: string, sessionId: string, dirName: string, fileName: string, content: string): string {
        const fullPath = path.join(SESSION_DIR, parentSessionId, sessionId, dirName, fileName);
        const absolutePath = this.getAbsolutePath(fullPath);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
        return fullPath;
    }

    public static sanitizeFileName(fileName: string): string {
        return fileName.replace(/[\/\*?<>&|:'"\\%^@`~]/g, '_');
    }

    public static isPathInWorkspace(filePath: string): boolean {
        const workspacePath = this.normalizeForCompare(process.cwd());
        const targetPath = this.normalizeForCompare(filePath);
        const workspacePrefix = workspacePath.endsWith(path.sep) ? workspacePath : `${workspacePath}${path.sep}`;
        return targetPath === workspacePath || targetPath.startsWith(workspacePrefix);
    }

    private static normalizeForCompare(value: string): string {
        const normalized = path.normalize(path.resolve(value));
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    private static getAbsolutePath(relativePath: string): string {
        relativePath = this.formatSlash(relativePath);
        if (path.isAbsolute(relativePath)) return relativePath;
        relativePath = relativePath.startsWith('./') ? relativePath.substring(2) : relativePath;
        relativePath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
        return `${this.formatSlash(path.resolve())}/${relativePath}`;
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
}
