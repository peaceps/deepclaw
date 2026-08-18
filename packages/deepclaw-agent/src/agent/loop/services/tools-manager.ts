import { ALL_LOOP_KINDS, LLMTool, ToolDesc } from '../../definitions/tool-definitions';
import { LoopKind } from '../../definitions/definitions';
import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool, taskLoopTool} from '../tools/sub-loop-tool';
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
import { generateImageTool } from '../tools/image-tool';
import { updateAgentRuntimeTool } from '../tools/agent-runtime-tool';
import { MCP_PREFIX, MCPService } from './mcp-service';

const tools: ToolDesc<any>[] = [
    taskLoopTool,
    subLoopTool,
    loadSkillDetailsTool,
    refreshSkillsTool,
    searchOnlineSkillsTool,
    downloadSkillTool,
    removeSkillTool,
    createSkillTool,
    base64Tool,
    generateImageTool,
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
    updateAgentRuntimeTool,
];

type ToolsStrorage<T extends (Record<string, ToolDesc<any>> | LLMTool[])> = Record<LoopKind, Record<AgentMode, T>>;

export class ToolsManager {

    private static map: ToolsStrorage<Record<string, ToolDesc<any>>> = {
        main: {agent: {}, chat: {}},
        task: {agent: {}, chat: {}},
        sub: {agent: {}, chat: {}},
    }

    private static array: ToolsStrorage<LLMTool[]> = {
        main: {agent: [], chat: []},
        task: {agent: [], chat: []},
        sub: {agent: [], chat: []},
    }

    static {
        this.initTools();
    }
    
    private static initTools(): void {
        const modes = Object.keys(this.map.main) as AgentMode[];
        for (const tool of tools) {
            for (const mode of modes) {
                for (const kind of ALL_LOOP_KINDS) {
                    if (this.isAvailable(tool, kind, mode)) {
                        this.map[kind][mode][tool.tool.name] = tool;
                        this.array[kind][mode].push(tool.tool);
                    }
                }
            }
        }
    }

    public static getToolDesc(loopKind: LoopKind, mode: AgentMode, name: string): ToolDesc<any> | undefined {
        if (name.startsWith(MCP_PREFIX)) {
            const tool = MCPService.getTools()[name];
            return tool && this.isAvailable(tool, loopKind, mode) ? tool : undefined;
        }
        return this.map[loopKind][mode][name];
    }

    public static getToolsArray(loopKind: LoopKind, mode: AgentMode): LLMTool[] {
        const builtIn = this.array[loopKind][mode];
        const mcp = Object.values(MCPService.getTools())
            .filter(tool => this.isAvailable(tool, loopKind, mode))
            .map(tool => tool.tool);
        return [...builtIn, ...mcp];
    }

    private static isAvailable(tool: ToolDesc<any>, loopKind: LoopKind, mode: AgentMode): boolean {
        return tool.agentMode.includes(mode) && (tool.loopKinds ?? ALL_LOOP_KINDS).includes(loopKind);
    }
}
