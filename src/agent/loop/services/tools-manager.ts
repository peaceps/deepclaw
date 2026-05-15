import { ToolDesc } from '../../definitions/tool-definitions.js';

import {shellTool} from '../tools/shell-tool.js';
import {todoTool} from '../tools/todo-tool.js';
import {subLoopTool, subLoopWithHistoryTool} from '../tools/sub-loop-tool.js';
import {loadSkillTool} from '../tools/skill-tool.js';
import {compactTool} from '../tools/compact-tool.js';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool.js';
import { loadAgentConfig, DeepclawConfig } from '@utils';

const tools: ToolDesc<any>[] = [
    shellTool,
    todoTool,
    subLoopTool,
    subLoopWithHistoryTool,
    loadSkillTool,
    compactTool,
    readFileTool,
    writeFileTool,
    editFileTool
];

export class ToolsManager {

    private static readonly agentMode = loadAgentConfig<DeepclawConfig['agent']['mode']>('mode');

    public static provideTools(isSubLoop: boolean): ToolDesc<any>[] {
        return tools.filter(tool =>
            tool.agentMode.includes(this.agentMode) && (!isSubLoop || !tool.exclusiveInSubLoop)
        );
    }
}
