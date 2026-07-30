import { LLMTool, ToolDesc } from '../../definitions/tool-definitions';
import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool} from '../tools/sub-loop-tool';
import {loadSkillDetailsTool, refreshSkillsTool, createSkillTool, searchOnlineSkillsTool, downloadSkillTool, removeSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
} from '../tools/background-command-tool';
import {saveMemoryTool, readMemoryDetailTool} from '../tools/save-memory-tool';
import {createCronTaskTool, updateCronOutputTool, updateCronTaskTool} from '../tools/cron-tool';
import {createProjectTool, createSimpleTaskTool, updateProjectTool, updateTaskTool,
    updateTaskCurrentStepTool, getProjectListTool, getProjectDetailTool} from '../tools/project-tool';
import { AgentMode } from '@deepclaw/config';
import { base64Tool } from '../tools/encode-decode-tool';
import { MCP_PREFIX, MCPService } from './mcp-service';

const tools: ToolDesc<any>[] = [
    subLoopTool,
    loadSkillDetailsTool,
    refreshSkillsTool,
    searchOnlineSkillsTool,
    downloadSkillTool,
    removeSkillTool,
    createSkillTool,
    base64Tool,
    readFileTool,
    writeFileTool,
    editFileTool,
    saveMemoryTool,
    readMemoryDetailTool,
    createCronTaskTool,
    updateCronOutputTool,
    updateCronTaskTool,
    createProjectTool,
    updateProjectTool,
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
        const modes = Object.keys(this.map.loop) as AgentMode[];
        for (const tool of tools) {
            for (const mode of modes) {
                if (this.isAvailable(tool, false, mode)) {
                    this.map.loop[mode][tool.tool.name] = tool;
                    this.array.loop[mode].push(tool.tool);
                }
                if (this.isAvailable(tool, true, mode)) {
                    this.map.subLoop[mode][tool.tool.name] = tool;
                    this.array.subLoop[mode].push(tool.tool);
                }
            }
        }
    }

    public static getToolDesc(isSubLoop: boolean, mode: AgentMode, name: string): ToolDesc<any> | undefined {
        if (name.startsWith(MCP_PREFIX)) {
            const tool = MCPService.getTools()[name];
            return tool && this.isAvailable(tool, isSubLoop, mode) ? tool : undefined;
        }
        if (isSubLoop) {
            return this.map.subLoop[mode][name];
        } else {
            return this.map.loop[mode][name];
        }
    }

    public static getToolsArray(isSubLoop: boolean, mode: AgentMode): LLMTool[] {
        const builtIn = isSubLoop ? this.array.subLoop[mode] : this.array.loop[mode];
        const mcp = Object.values(MCPService.getTools())
            .filter(tool => this.isAvailable(tool, isSubLoop, mode))
            .map(tool => tool.tool);
        return [...builtIn, ...mcp];
    }

    private static isAvailable(tool: ToolDesc<any>, isSubLoop: boolean, mode: AgentMode): boolean {
        return tool.agentMode.includes(mode) && !(isSubLoop && tool.exclusiveInSubLoop);
    }
}
