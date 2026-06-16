'use client';

import { InfoCard } from "@/laf/info-card";
import { AgentEmployee, AgentSoulIdentity } from "@deepclaw/core";
import { Zap } from "lucide-react";
import { useCallback } from "react";
import { EditableLabels } from "@/laf/editable-labels";

export function AgentDetailSkills({ agent, onUpdate }: {
    agent: AgentEmployee; onUpdate: (id: string, patch: Partial<AgentSoulIdentity>) => void 
}) {
  const onSkillsChange = useCallback((list: string[]) => {
    onUpdate(agent.id, { skills: list });
  }, [onUpdate, agent.id]);

  return (
    <InfoCard title="pages.agents.details.skills.title" icon={<Zap size={20} />} color="blue">
      <div className="space-y-4">
        {/* 技能 */}
        <div>
          <EditableLabels
            labels={agent.skills}
            onChange={onSkillsChange}
            color="blue"
          />
        </div>
      </div>
    </InfoCard>
  );
}
