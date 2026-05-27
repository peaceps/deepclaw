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

    public static writeFileToSession(parentSessionId: string, sessionId: string, dirName: string, fileName: string, content: string): string {
        const fullPath = path.join(SESSION_DIR, parentSessionId, sessionId, dirName, this.sanitizeFileName(fileName));
        const absolutePath = this.getAbsolutePath(fullPath);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
        return fullPath;
    }

    public static isPathInWorkspace(filePath: string): boolean {
        let workspacePath = this.getAbsolutePath(process.cwd());
        let targetPath = this.getAbsolutePath(filePath);
        if (process.platform === 'win32' || process.platform === 'darwin') {
            workspacePath = workspacePath.toLowerCase();
            targetPath = targetPath.toLowerCase();
        }
        const workspacePrefix = workspacePath.endsWith('/') ? workspacePath : `${workspacePath}/`;
        return targetPath === workspacePath || targetPath.startsWith(workspacePrefix);
    }

    private static getAbsolutePath(relativePath: string): string {
        return this.formatSlash(path.isAbsolute(relativePath) ? relativePath : path.resolve(relativePath));
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

    private static sanitizeFileName(fileName: string): string {
        return this.formatSlash(fileName).replace(/[\*?<>&|:'"%^@`~]/g, '_');
    }
}
