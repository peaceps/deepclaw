import { LLMTool, ToolDesc } from '../../definitions/tool-definitions';
import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool} from '../tools/sub-loop-tool';
import {loadSkillTool, refreshSkillTool, deleteSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
} from '../tools/background-command-tool';
import {saveMemoryTool, readMemoryDetailTool} from '../tools/save-memory-tool';
import {createCronTaskTool, updateCronOutputTool} from '../tools/cron-tool';
import {createProjectTool, createSimpleTaskTool, updateTaskTool,
    updateTaskCurrentStepTool, getProjectListTool, getProjectDetailTool} from '../tools/project-tool';
import { AgentMode } from '@deepclaw/config';
import { base64Tool } from '../tools/encode-decode-tool';

const tools: ToolDesc<any>[] = [
    subLoopTool,
    loadSkillTool,
    refreshSkillTool,
    deleteSkillTool,
    base64Tool,
    readFileTool,
    writeFileTool,
    editFileTool,
    saveMemoryTool,
    readMemoryDetailTool,
    createCronTaskTool,
    updateCronOutputTool,
    createProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
    getProjectDetailTool,
    getProjectListTool,
    createSimpleTaskTool,
    syncCommandTool,
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool,
];

type ToolsStrorage<T extends (Record<string, ToolDesc<any>> | LLMTool[])> = {
    loop: Record<AgentMode, T>;
    subLoop: Record<AgentMode, T>;
}

export class ToolsManager {

    private static map: ToolsStrorage<Record<string, ToolDesc<any>>> = {
        loop: {agent: {}, chat: {}},
        subLoop: {agent: {}, chat: {}},
    }

    private static array: ToolsStrorage<LLMTool[]> = {
        loop: {agent: [], chat: []},
        subLoop: {agent: [], chat: []},
    }

    static {
        this.initTools();
    }
    
    private static initTools(): void {
        for (const tool of tools) {
            for (const mode of tool.agentMode) {
                this.map.loop[mode][tool.tool.name] = tool;
                this.array.loop[mode].push(tool.tool);
                if (!tool.exclusiveInSubLoop) {
                    this.map.subLoop[mode][tool.tool.name] = tool;
                    this.array.subLoop[mode].push(tool.tool);
                }
            }
        }
    }

    public static getToolDesc(isSubLoop: boolean, mode: AgentMode, name: string): ToolDesc<any> | undefined {
        if (isSubLoop) {
            return this.map.subLoop[mode][name];
        } else {
            return this.map.loop[mode][name];
        }
    }

    public static getToolsArray(isSubLoop: boolean): Record<AgentMode, LLMTool[]> {
        if (isSubLoop) {
            return this.array.subLoop;
        } else {
            return this.array.loop;
        }
    }
}
