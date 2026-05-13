import fs from 'fs';
import path from 'path';
import { loadAgentConfig } from './config-utils';

export class FileUtils {

    private static sessionDir: string = loadAgentConfig<string>('sessionDir');

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

    public static writeFile(filePath: string, content: string): void {
        const absolutePath = this.getAbsolutePath(filePath);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
    }

    public static writeFileToSession(parentSessionId: string, sessionId: string, dirName: string, fileName: string, content: string): string {
        const fullPath = path.join(this.sessionDir, parentSessionId, sessionId, dirName, fileName);
        const absolutePath = this.getAbsolutePath(fullPath);
        this.ensureFolderExist(absolutePath);
        fs.writeFileSync(absolutePath, content, 'utf8');
        return fullPath;
    }

    public static isPathInWorkspace(filePath: string): boolean {
        const absolutePath = this.getAbsolutePath(filePath);
        const workspacePath = this.getAbsolutePath(process.cwd());
        return absolutePath.startsWith(workspacePath);
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
