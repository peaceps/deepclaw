'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentOption } from '@/server/data';
import { setSkillAgents } from '@/server/data';
import type { SkillInfo } from '@deepclaw/loop-gateway';
import { MultiSelect } from '@/laf/multi-select';
import { InfoBar } from '@/laf/info-bar';

type SkillsProps = {
    skills: SkillInfo[];
    agents: AgentOption[];
};

export function Skills({ skills: initialSkills, agents }: SkillsProps) {
    const { t } = useTranslation();
    const [skills, setSkills] = useState(initialSkills);
    const agentOptions = agents.map(a => ({ id: a.id, label: a.name }));

    const toggleAgent = async (skillName: string, agentId: string) => {
        const skill = skills.find(s => s.name === skillName);
        if (!skill) return;

        const current = new Set(skill.agents ?? agents.map(a => a.id));
        if (current.has(agentId)) {
            current.delete(agentId);
        } else {
            current.add(agentId);
        }
        const newAgents = Array.from(current);

        await updateAgents(skill, newAgents);
    };

    const resetToAll = async (skillName: string) => {
        const skill = skills.find(s => s.name === skillName);
        if (!skill) return;
        await updateAgents(skill, undefined);
    };

    const updateAgents = async (skill: SkillInfo, newAgents?: string[]) => {
        const skillName = skill.name;
        setSkills(prev => prev.map(s =>
            s.name === skillName ? { ...s, agents: newAgents } : s
        ));
        try {
            await setSkillAgents(skillName, newAgents);
        } catch {
            setSkills(prev => prev.map(s =>
                s.name === skillName ? { ...s, agents: skill.agents } : s
            ));
        }
    };

    return (
        <div className="h-full w-full overflow-auto p-6">
            <h1 className="text-2xl font-bold text-gray-800 mb-4">{t('web.sidebar.links.skills')}</h1>
            <InfoBar message={t('web.pages.skills.installHint')} />
            <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                        <tr className="divide-x divide-gray-200">
                            <th className="px-4 py-3 font-medium">{t('web.pages.skills.columns.name')}</th>
                            <th className="px-4 py-3 font-medium">{t('web.pages.skills.columns.description')}</th>
                            <th className="px-4 py-3 font-medium">{t('web.pages.skills.columns.agent')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {skills.length === 0 ? (
                            <tr>
                                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                                    {t('web.pages.skills.empty')}
                                </td>
                            </tr>
                        ) : skills.map((skill) => {
                            const isAll = !skill.agents;
                            const selected = new Set(isAll ? agents.map(a => a.id) : skill.agents);
                            return (
                                <tr key={skill.name} className="divide-x divide-gray-200 hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{skill.name}</td>
                                    <td className="px-4 py-3 text-gray-600">{skill.description}</td>
                                    <td className="px-4 py-3">
                                        <MultiSelect
                                            options={agentOptions}
                                            selected={selected}
                                            onToggle={(agentId) => toggleAgent(skill.name, agentId)}
                                            onResetAll={() => resetToAll(skill.name)}
                                            resetLabel={t('web.pages.skills.resetToAll')}
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
