'use client';

import { InfoCard } from "./InfoCard";
import { AgentEmployee } from "@deepclaw/core";
import { Zap } from "lucide-react";
import { TraitBadge } from "./TraitBadge";
import { useTranslation } from "react-i18next";

export function AgentDetailSkills({ agent }: { agent: AgentEmployee }) {
  const {t} = useTranslation();
  return (
    <InfoCard title={t('pages.agents.details.skills.title')} icon={<Zap size={20} />}>
      <div className="space-y-4">
        {/* 技能 */}
        <div>
          <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.skills.skills')}</label>
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
