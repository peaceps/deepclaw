'use client';

import type { AgentEmployee, AgentSoulIdentity } from "@deepclaw/core";
import { InfoCard } from "@/laf/info-card";
import { Heart } from "lucide-react";
import { DeepSwitch } from "@/laf/deep-switch";
import { useCallback } from "react";
import { EditableLabels } from "@/laf/editable-labels";
import { UpdateContent } from "@deepclaw/utils";

export function AgentDetailPersonality({ agent, onUpdate }: {
    agent: AgentEmployee; onUpdate: (patch: UpdateContent<AgentSoulIdentity>) => void 
}) {
    const onEmotionSwitch = useCallback(() => {
      const next = !agent.emotion;
      onUpdate({id: agent.id, emotion: next });
    }, [agent, onUpdate]);

    const onPersonalitiesChange = useCallback((list: string[]) => {
      onUpdate({id: agent.id, personalities: list });
    }, [onUpdate, agent.id]);

    return (
      <InfoCard title="web.pages.agents.details.personality.title" icon={<Heart size={20} />} color="purple">
        <div className="space-y-4">
          {/* 性格特征 */}
          <div>
            <EditableLabels
              labels={agent.personalities}
              onChange={onPersonalitiesChange}
              color="purple"
            />
          </div>
  
          {/* 情感表达 */}
          <DeepSwitch 
            label="web.pages.agents.details.personality.emotionExpression"
            labelFont="text-gray-500"
            color="purple"
            value={agent.emotion}
            onSwitch={onEmotionSwitch}
          />

        </div>
      </InfoCard>
    );
}
