import { ToolDesc } from '../../definitions/tool-definitions.js';

import {shellTool} from '../tools/shell-tool.js';
import {todoTool} from '../tools/todo-tool.js';
import {subLoopTool} from '../tools/sub-loop-tool.js';
import {loadSkillTool} from '../tools/skill-tool.js';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool.js';

export class ToolsManager {
    private static readonly concurrencySafeTools: ToolDesc<any>[] = [readFileTool, todoTool, loadSkillTool, subLoopTool];
    private static readonly concurrencyUnsafeTools: ToolDesc<any>[] = [shellTool, writeFileTool, editFileTool];
    private static readonly builtInTools: ToolDesc<any>[] = [...this.concurrencySafeTools, ...this.concurrencyUnsafeTools];

    private static readonly subLoopBuiltInTools: ToolDesc<any>[] = [readFileTool, todoTool, shellTool, loadSkillTool];
    private static readonly subLoopConcurrencySafeTools: ToolDesc<any>[] = this.subLoopBuiltInTools.filter(tool => this.concurrencySafeTools.includes(tool));
    private static readonly subLoopConcurrencyUnsafeTools: ToolDesc<any>[] = this.subLoopBuiltInTools.filter(tool => this.concurrencyUnsafeTools.includes(tool));

    public static provideTools(isSubLoop: boolean): ToolDesc[] {
        return isSubLoop ? this.subLoopBuiltInTools : this.builtInTools;
    }

    public static provideConcurrencySafeTools(isSubLoop: boolean): ToolDesc<any>[] {
        return isSubLoop ? this.subLoopConcurrencySafeTools : this.concurrencySafeTools;
    }

    public static provideConcurrencyUnsafeTools(isSubLoop: boolean): ToolDesc<any>[] {
        return isSubLoop ? this.subLoopConcurrencyUnsafeTools : this.concurrencyUnsafeTools;
    }
}