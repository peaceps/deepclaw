'use server';

import type { Task, CronTask, AgentSoulIdentity } from "@deepclaw/core";
import { LoopGateway, type SkillInfo } from "@deepclaw/loop-gateway";
import { revalidatePath } from "next/cache";

export async function updateAgentIdentity(id: string, identity: Partial<AgentSoulIdentity> | string): Promise<void> {
    try {
      if (typeof identity === 'string') {
          LoopGateway.updateAgentDescription(id, identity);
      } else {
          if (identity.avatar && identity.avatar.length > 16) {
              throw new Error('Invalid avatar');
          }
          LoopGateway.updateAgentIdentity(id, identity);
      }
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
    projectId: string, taskTitle: string, task: Pick<Task, 'pause' | 'verified'>
): Promise<void> {
    try {
        LoopGateway.updateProjectTask(projectId, taskTitle, task);
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

export async function updateCronTaskStatus(id: string, pause?: boolean, close?: boolean): Promise<void> {
    try {
        LoopGateway.updateCronTaskStatus(id, pause, close);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error updating cron task status:', error);
        throw error;
    }
}
