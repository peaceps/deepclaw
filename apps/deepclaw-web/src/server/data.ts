'use server';

import type { Task } from "@deepclaw/core";
import { AgentSoulIdentity } from "@deepclaw/core";
import { LoopGateway } from "@deepclaw/loop-gateway";
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
    projectId: string, taskTitle: string, task: Pick<Task, 'pause'>
): Promise<void> {
    try {
        LoopGateway.updateProjectTask(projectId, taskTitle, task);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error saving project task:', error);
        throw error;
    }
}
