'use client';

import { InfoCard } from "@/laf/info-card";
import { AgentEmployee } from "@deepclaw/core";
import { Zap } from "lucide-react";
import { TraitBadge } from "@/laf/trait-badge";

export function AgentDetailSkills({ agent }: { agent: AgentEmployee }) {
  return (
    <InfoCard title="pages.agents.details.skills.title" icon={<Zap size={20} />}>
      <div className="space-y-4">
        {/* 技能 */}
        <div>
          <div className="flex flex-wrap gap-2">
            {agent.skills?.map((skill) => (
              <TraitBadge key={skill} text={skill} color="blue" />
            ))}
          </div>
        </div>
      </div>
    </InfoCard>
  );
}
