'use server';

import { LoopGateway, type SkillInfo } from '@deepclaw/loop-gateway';
import { revalidatePath } from 'next/cache';

export type AgentOption = {
    id: string;
    name: string;
};

/**
 * Get all available skills with their assigned agents.
 */
export async function getSkills(): Promise<SkillInfo[]> {
    return LoopGateway.getSkills();
}

/**
 * Get all active (non-fired) agents.
 */
export async function getActiveAgents(): Promise<AgentOption[]> {
    const loopInfo = LoopGateway.getLoopInfo();
    return loopInfo.agents
        .filter(a => !a.fired)
        .map(a => ({ id: a.id, name: a.name }));
}

/**
 * Update the assigned agents for a skill.
 * Pass empty array to assign to no agents (creates agent.json with []).
 * Pass undefined to remove agent.json (open to all agents).
 */
export async function setSkillAgents(skillName: string, agentIds?: string[]): Promise<void> {
    LoopGateway.setSkillAgents(skillName, agentIds);
    revalidatePath('/', 'layout');
}
