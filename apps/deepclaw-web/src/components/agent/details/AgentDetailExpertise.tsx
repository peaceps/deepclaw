'use client';

import { InfoCard } from "@/laf/info-card";
import type { AgentEmployee, AgentSoulIdentity } from "@deepclaw/core";
import { Zap } from "lucide-react";
import { useCallback } from "react";
import { EditableLabels } from "@/laf/editable-labels";

export function AgentDetailExpertise({ agent, onUpdate }: {
    agent: AgentEmployee; onUpdate: (id: string, patch: Partial<AgentSoulIdentity>) => void 
}) {
  const onExpertisesChange = useCallback((list: string[]) => {
    onUpdate(agent.id, { expertises: list });
  }, [onUpdate, agent.id]);

  return (
    <InfoCard title="web.pages.agents.details.expertises.title" icon={<Zap size={20} />} color="blue">
      <div className="space-y-4">
        <div>
          <EditableLabels
            labels={agent.expertises}
            onChange={onExpertisesChange}
            color="blue"
          />
        </div>
      </div>
    </InfoCard>
  );
}
