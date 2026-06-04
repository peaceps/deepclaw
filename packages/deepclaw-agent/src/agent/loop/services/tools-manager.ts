import { ToolDesc } from '../../definitions/tool-definitions';

import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool, subLoopWithHistoryTool} from '../tools/sub-loop-tool';
import {loadSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {runBackgroundCommandTool, checkAllBackgroundCommandStatusTool, checkBackgroundCommandStatusTool} from '../tools/background-command-tool';
import {saveMemoryTool} from '../tools/save-memory-tool';
import {createProjectTool, createStandaloneTaskTool, updateTaskTool, updateTaskCurrentStepTool, getProjectListTool,
    getProjectDetailTool, getStandaloneTaskInfoTool} from '../tools/project-tool';
import { loadConfig, DeepclawConfig } from '@deepclaw/config';

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
    getStandaloneTaskInfoTool,
    createStandaloneTaskTool,
    runBackgroundCommandTool,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
];

export class ToolsManager {
    public static provideTools(isSubLoop: boolean): ToolDesc<any>[] {
        const agentMode = loadConfig<DeepclawConfig['agent']['mode']>('agent.mode');
        return tools.filter(tool =>
            tool.agentMode.includes(agentMode) && (!isSubLoop || !tool.exclusiveInSubLoop)
        );
    }
}
