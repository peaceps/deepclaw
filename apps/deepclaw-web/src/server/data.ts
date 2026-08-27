'use server';

import type { Task, CronJobHistory, AgentSoulIdentity, SlimProject } from "@deepclaw/core";
import { LoopGateway, type DeepclawDataInfo, type SkillInfo } from "@deepclaw/loop-gateway";
import { UpdateContent } from "@deepclaw/utils";
import { revalidatePath } from "next/cache";

export async function updateAgentIdentity(identity: UpdateContent<AgentSoulIdentity>): Promise<void> {
    try {
        if (identity.avatar && identity.avatar.length > 16) {
            throw new Error('Invalid avatar');
        }
        LoopGateway.updateAgentIdentity(identity);
        revalidatePath('/', 'layout');
    } catch (error) {
        // TODO Handle error revert UI
        console.error('Error saving agent identity:', error);
        throw error;
    }
}

export async function updateProjectTags(projectId: string, tags: string[]): Promise<void> {
    try {
        LoopGateway.updateProjectTags(projectId, tags);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error saving project tags:', error);
        throw error;
    }
}

/**
 * Everything a page holds, as it stands now.
 *
 * Read once where the page is built, and again by a browser whose stream dropped and came back:
 * what went out while it was away went to nobody and is kept nowhere, so there is nothing to hand
 * it but the whole of it over again.
 */
export async function getDataInfo(): Promise<DeepclawDataInfo> {
    try {
        return LoopGateway.getDataInfo();
    } catch (error) {
        console.error('Error reading the data info:', error);
        throw error;
    }
}

/**
 * The whole of one project, tasks included, for a row that just opened on it. The board is handed
 * every project without any of their tasks, so this is where the tasks of one come from.
 */
export async function getProjectDetail(projectId: string): Promise<SlimProject> {
    try {
        return LoopGateway.getProjectDetail(projectId);
    } catch (error) {
        console.error('Error reading project detail:', error);
        throw error;
    }
}

export async function archiveProject(projectId: string): Promise<void> {
    try {
        LoopGateway.archiveProject(projectId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error archiving project:', error);
        throw error;
    }
}

/** The id finds the task, the rest is everything a card on the board is allowed to write. */
export type TaskEdit =
    Pick<Task, 'id'> & Partial<Pick<Task, 'title' | 'description' | 'pause' | 'verified' | 'assignee'>>;

/**
 * What this takes is what anyone who reaches the page can send, and the gateway behind it writes
 * whole task patches, so the fields are copied over one by one: a request that also carried an
 * output or a closing date would otherwise have those filed as the user's doing too. Who a task
 * falls to is the user's to write, and the gateway holds it to an agent that works here.
 */
export async function updateProjectTask(projectId: string, task: TaskEdit): Promise<void> {
    try {
        // Undefined is a value to the Object.assign at the end of this, so only what came in goes on.
        const patch: TaskEdit = {id: task.id};
        if (task.title !== undefined) patch.title = task.title;
        if (task.description !== undefined) patch.description = task.description;
        if (task.pause !== undefined) patch.pause = task.pause;
        if (task.verified !== undefined) patch.verified = task.verified;
        if (task.assignee !== undefined) patch.assignee = task.assignee;
        LoopGateway.updateProjectTask(projectId, patch);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error saving project task:', error);
        throw error;
    }
}

export type AgentOption = {
    id: string;
    name: string;
};

export async function getActiveAgents(): Promise<AgentOption[]> {
    const dataInfo = LoopGateway.getDataInfo();
    return dataInfo.agents
        .filter(a => !a.fired)
        .map(a => ({ id: a.id, name: a.name }));
}

export async function getSkills(): Promise<SkillInfo[]> {
    return LoopGateway.getSkills();
}

export async function setSkillAgents(skillName: string, agentIds?: string[]): Promise<void> {
    try {
        LoopGateway.setSkillAgents(skillName, agentIds);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error setting skill agents:', error);
        throw error;
    }
}

/**
 * Deletes a skill and reads the list back, so the page shows what is on disk rather than the row
 * it hoped to lose: a skill the manager no longer knows takes nothing with it, and the flag says so.
 */
export async function removeSkill(skillName: string): Promise<{removed: boolean, skills: SkillInfo[]}> {
    try {
        const removed = LoopGateway.removeSkill(skillName);
        revalidatePath('/', 'layout');
        return {removed, skills: LoopGateway.getSkills()};
    } catch (error) {
        console.error('Error removing skill:', error);
        throw error;
    }
}

export async function getCronHistories(
    id: string, beforeStart: number, limit?: number
): Promise<CronJobHistory[]> {
    return LoopGateway.getCronHistories(id, beforeStart, limit);
}

export async function updateCronTaskStatus(id: string, pause?: boolean, close?: boolean): Promise<void> {
    try {
        LoopGateway.updateCronTaskStatus(id, pause, close);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error updating cron task status:', error);
        throw error;
    }
}
