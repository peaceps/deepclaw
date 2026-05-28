import { ToolDesc } from '../../definitions/tool-definitions.js';

import {shellTool} from '../tools/shell-tool.js';
import {subLoopTool, subLoopWithHistoryTool} from '../tools/sub-loop-tool.js';
import {loadSkillTool} from '../tools/skill-tool.js';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool.js';
import {saveMemoryTool} from '../tools/save-memory-tool.js';
import {createProjectTool, createStandaloneTaskTool, updateTaskTool, updateTaskCurrentStepTool, getProjectListTool,
    getProjectDetailTool, getStandaloneTaskInfoTool} from '../tools/project-tool.js';
import { loadConfig, DeepclawConfig } from '@deepclaw/utils';

const tools: ToolDesc<any>[] = [
    shellTool,
    subLoopTool,
    subLoopWithHistoryTool,
    loadSkillTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    saveMemoryTool,
    createProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
    getProjectDetailTool,
    getProjectListTool,
    getStandaloneTaskInfoTool,
    createStandaloneTaskTool
];

export class ToolsManager {
    public static provideTools(isSubLoop: boolean): ToolDesc<any>[] {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode');
        return tools.filter(tool =>
            tool.agentMode.includes(agentMode) && (!isSubLoop || !tool.exclusiveInSubLoop)
        );
    }
}
