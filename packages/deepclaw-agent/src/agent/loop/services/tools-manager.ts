import { ToolDesc } from '../../definitions/tool-definitions';

import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool, subLoopWithHistoryTool} from '../tools/sub-loop-tool';
import {loadSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {runBackgroundCommandTool, checkAllBackgroundCommandStatusTool, checkBackgroundCommandStatusTool} from '../tools/background-command-tool';
import {saveMemoryTool} from '../tools/save-memory-tool';
import {createProjectTool, createSimpleTaskTool, updateTaskTool, updateTaskCurrentStepTool, getProjectListTool,
    getProjectDetailTool} from '../tools/project-tool';
import { DeepclawConfig } from '@deepclaw/config';

const tools: ToolDesc<any>[] = [
    syncCommandTool,
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
    createSimpleTaskTool,
    runBackgroundCommandTool,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
];

export class ToolsManager {
    public static provideTools(isSubLoop: boolean, agentMode: DeepclawConfig['agents'][0]['mode']): ToolDesc<any>[] {
        return tools.filter(tool =>
            tool.agentMode.includes(agentMode) && (!isSubLoop || !tool.exclusiveInSubLoop)
        );
    }
}
