import { ToolDesc } from '../../definitions/tool-definitions.js';

import {shellTool} from '../tools/shell-tool.js';
import {todoTool} from '../tools/todo-tool.js';
import {subLoopTool, subLoopWithHistoryTool} from '../tools/sub-loop-tool.js';
import {loadSkillTool} from '../tools/skill-tool.js';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool.js';
import { loadConfig, DeepclawConfig } from '@deepclaw/utils';

const tools: ToolDesc<any>[] = [
    shellTool,
    todoTool,
    subLoopTool,
    subLoopWithHistoryTool,
    loadSkillTool,
    readFileTool,
    writeFileTool,
    editFileTool
];

export class ToolsManager {
    public static provideTools(isSubLoop: boolean): ToolDesc<any>[] {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode');
        return tools.filter(tool =>
            tool.agentMode.includes(agentMode) && (!isSubLoop || !tool.exclusiveInSubLoop)
        );
    }
}
