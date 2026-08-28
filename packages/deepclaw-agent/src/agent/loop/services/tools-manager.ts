import {
    ALL_AGENT_MODES, ALL_AGENT_ROLES, ALL_LOOP_KINDS, LLMTool, ToolDesc, ToolRun
} from '../../definitions/tool-definitions';
import {syncCommandTool} from '../tools/sync-command-tool';
import {subLoopTool, taskLoopTool} from '../tools/spawned-loop-tool';
import {loadSkillDetailsTool, refreshSkillsTool, createSkillTool, searchOnlineSkillsTool, downloadSkillTool, removeSkillTool} from '../tools/skill-tool';
import {readFileTool, writeFileTool, editFileTool} from '../tools/file-tool';
import {
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool
} from '../tools/background-command-tool';
import {saveMemoryTool, readMemoryDetailTool} from '../tools/save-memory-tool';
import {createCronTaskTool, getCronHistoriesTool, updateCronOutputTool, updateCronTaskTool} from '../tools/cron-tool';
import {createProjectTool, updateProjectTool, updateTaskTool,
    updateTaskCurrentStepTool, getProjectListTool, getProjectDetailTool} from '../tools/project-tool';
import { base64Tool } from '../tools/encode-decode-tool';
import { generateImageTool, keepImageTool } from '../tools/image-tool';
import { updateAgentRuntimeTool } from '../tools/agent-runtime-tool';
import { askUserTool } from '../tools/ask-user-tool';
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
    keepImageTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    saveMemoryTool,
    readMemoryDetailTool,
    createCronTaskTool,
    updateCronOutputTool,
    updateCronTaskTool,
    getCronHistoriesTool,
    createProjectTool,
    updateProjectTool,
    updateTaskTool,
    updateTaskCurrentStepTool,
    getProjectDetailTool,
    getProjectListTool,
    syncCommandTool,
    runBackgroundCommandTool,
    removeBackgroundCommand,
    checkAllBackgroundCommandStatusTool,
    checkBackgroundCommandStatusTool,
    updateAgentRuntimeTool,
    askUserTool,
];

export class ToolsManager {

    private static map = new Map<string, Record<string, ToolDesc<any>>>();

    private static array = new Map<string, LLMTool[]>();

    static {
        this.initTools();
    }

    private static initTools(): void {
        for (const loopKind of ALL_LOOP_KINDS) {
            for (const role of ALL_AGENT_ROLES) {
                for (const mode of ALL_AGENT_MODES) {
                    const run = {loopKind, role, mode};
                    const named: Record<string, ToolDesc<any>> = {};
                    const listed: LLMTool[] = [];
                    for (const tool of tools.filter(one => this.isAvailable(one, run))) {
                        named[tool.tool.name] = tool;
                        listed.push(tool.tool);
                    }
                    this.map.set(this.keyOf(run), named);
                    this.array.set(this.keyOf(run), listed);
                }
            }
        }
    }

    public static getToolDesc(run: ToolRun, name: string): ToolDesc<any> | undefined {
        if (name.startsWith(MCP_PREFIX)) {
            const tool = MCPService.getTools()[name];
            return tool && this.isAvailable(tool, run) ? tool : undefined;
        }
        return this.map.get(this.keyOf(run))?.[name];
    }

    public static getToolsArray(run: ToolRun): LLMTool[] {
        const builtIn = this.array.get(this.keyOf(run)) ?? [];
        // The tools are read before anything else of a prompt, so their order is the start of what
        // a cache is found by. Servers answer whenever they answer, which is no order to hand over:
        // by name they land the same way in every call, however they arrived in this one.
        const mcp = Object.values(MCPService.getTools())
            .filter(tool => this.isAvailable(tool, run))
            .map(tool => tool.tool)
            .sort((left, right) => left.name.localeCompare(right.name));
        return [...builtIn, ...mcp];
    }

    private static keyOf(run: ToolRun): string {
        return `${run.loopKind}.${run.role}.${run.mode}`;
    }

    private static isAvailable(tool: ToolDesc<any>, run: ToolRun): boolean {
        return tool.agentMode.includes(run.mode)
            && (tool.loopKinds ?? ALL_LOOP_KINDS).includes(run.loopKind)
            && (tool.roles ?? ALL_AGENT_ROLES).includes(run.role);
    }
}
