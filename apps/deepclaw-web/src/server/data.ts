'use server';

import type {
    Task, CronJobHistory, AgentSoulIdentity, SlimProject, ArchivedProjectsAsk, ArchivedProjectsPage
} from "@deepclaw/core";
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

/** Emptying the box is not a description: what the board would show for it is nothing at all. */
export async function updateProjectDescription(projectId: string, description: string): Promise<void> {
    try {
        if (!description.trim()) {
            throw new Error('A project needs a description');
        }
        LoopGateway.updateProjectDescription(projectId, description);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error saving project description:', error);
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

/**
 * The user setting the work going. Only the date is written here: the run that follows is the one
 * the chat sends, so the words that start the project reach the agent and the transcript together.
 */
export async function startProject(projectId: string): Promise<void> {
    try {
        LoopGateway.startProject(projectId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error starting project:', error);
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

/**
 * A page of the projects the user has put away, for the one window that looks back through them.
 * The board is handed none of these: they left it, and nothing but this asks after them.
 */
export async function getArchivedProjects(ask: ArchivedProjectsAsk): Promise<ArchivedProjectsPage> {
    try {
        return LoopGateway.listArchivedProjects(ask);
    } catch (error) {
        console.error('Error reading the archived projects:', error);
        throw error;
    }
}

/**
 * The user taking a project back out of the archive. The board hears of it as an event like any
 * other, so the page it lands on is every page open, not only the one that asked.
 */
export async function restoreProject(projectId: string): Promise<void> {
    try {
        LoopGateway.restoreProject(projectId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error restoring project:', error);
        throw error;
    }
}

/**
 * The user throwing an archived project away for good.
 *
 * Nothing is revalidated. No board held this project -- it left them when it was put away -- and the
 * one thing that does change, the count of finished projects put away on the agent that planned it,
 * reaches every page as an event and is already the new number to a page that loads after.
 */
export async function deleteArchivedProject(projectId: string): Promise<void> {
    try {
        LoopGateway.deleteArchivedProject(projectId);
    } catch (error) {
        console.error('Error deleting the archived project:', error);
        throw error;
    }
}

/**
 * The id finds the task, the rest is everything a card on the board is allowed to write.
 *
 * No status among them. Moving a task on is one thing to ask for and two to write either way --
 * taking one up may set the project going, closing one marks every step of it behind it -- and the
 * two below ask for those as the one thing each of them is.
 */
export type TaskEdit =
    Pick<Task, 'id'>
    & Partial<Pick<Task,
        'title' | 'description' | 'pause' | 'verified' | 'assignee' | 'reviewer' | 'priority'>>;

/**
 * What this takes is what anyone who reaches the page can send, and the gateway behind it writes
 * whole task patches, so the fields are copied over one by one: a request that also carried an
 * output or a closing date would otherwise have those filed as the user's doing too. Who a task
 * falls to is the user's to write, and the gateway holds it to an agent that works here; which of
 * the four words a priority is, and whether the task is still one to be worked at all, is answered
 * where the task is written down, the board being one of the ways in and not the only one.
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
        // The empty string among them: it is how a card says the task is to be read over by nobody,
        // and the service reads it as that. Dropped here, taking a reviewer off would do nothing.
        if (task.reviewer !== undefined) patch.reviewer = task.reviewer;
        if (task.priority !== undefined) patch.priority = task.priority;
        LoopGateway.updateProjectTask(projectId, patch);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error saving project task:', error);
        throw error;
    }
}

/**
 * The user taking a task up themselves, which sets the project going where it had not been started.
 * Asked for by id, the same as closing one below: neither is a field a card gets to name.
 */
export async function takeUpProjectTask(projectId: string, taskId: string): Promise<void> {
    try {
        LoopGateway.takeUpProjectTask(projectId, taskId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error taking up project task:', error);
        throw error;
    }
}

/**
 * The user marking a task done, steps and all. Asked for by id rather than sent as a patch: what is
 * written is not the caller's to choose, and a card that could name the fields would be a card that
 * could close a task with half its steps unmarked.
 */
export async function finishProjectTask(projectId: string, taskId: string): Promise<void> {
    try {
        LoopGateway.finishProjectTask(projectId, taskId);
        revalidatePath('/', 'layout');
    } catch (error) {
        console.error('Error finishing project task:', error);
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
