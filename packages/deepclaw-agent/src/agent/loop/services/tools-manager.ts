import { LLMTool, ToolDesc } from '../../definitions/tool-definitions';
import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool} from '../tools/sub-loop-tool';
import {loadSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
} from '../tools/background-command-tool';
import {saveMemoryTool, readMemoryDetailTool} from '../tools/save-memory-tool';
import {createProjectTool, createSimpleTaskTool, updateTaskTool,
    updateTaskCurrentStepTool, getProjectListTool, getProjectDetailTool} from '../tools/project-tool';
import { AgentMode } from '@deepclaw/config';

const tools: ToolDesc<any>[] = [
    syncCommandTool,
    subLoopTool,
    loadSkillTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    saveMemoryTool,
    readMemoryDetailTool,
    createProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
    getProjectDetailTool,
    getProjectListTool,
    createSimpleTaskTool,
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
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
