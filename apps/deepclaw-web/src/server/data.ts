'use server';

import type { Task, CronTask, CronJobHistory, AgentSoulIdentity } from "@deepclaw/core";
import { LoopGateway, type SkillInfo } from "@deepclaw/loop-gateway";
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

export async function updateProjectTask(
    projectId: string, task: UpdateContent<Task, 'title'>
): Promise<void> {
    try {
        LoopGateway.updateProjectTask(projectId, task);
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
    const loopInfo = LoopGateway.getLoopInfo();
    return loopInfo.agents
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

export async function getCronTasks(): Promise<CronTask[]> {
    return LoopGateway.getCronTasks();
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
