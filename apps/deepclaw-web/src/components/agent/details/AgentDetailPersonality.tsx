'use client';

import { AgentEmployee } from "@deepclaw/core";
import { InfoCard } from "@/laf/info-card";
import { TraitBadge } from "@/laf/trait-badge";
import { Heart } from "lucide-react";
import { DeepSwitch } from "@/laf/deep-switch";
import { useCallback, useState } from "react";

export function AgentDetailPersonality({ agent }: { agent: AgentEmployee }) {
    // TODO add persistent
    const [emotion, setEmotion] = useState(agent.emotion);
    const onEmotionSwitch = useCallback(() => {
      setEmotion(old => !old);
    }, []);

    return (
      <InfoCard title="pages.agents.details.personality.title" icon={<Heart size={20} />}>
        <div className="space-y-4">
          {/* 性格特征 */}
          <div>
            <div className="flex flex-wrap gap-2">
              {agent.personalities.map((p) => (
                <TraitBadge key={p} text={p} color="purple" />
              ))}
            </div>
          </div>
  
          {/* 情感表达 */}
          <DeepSwitch 
            label="pages.agents.details.personality.emotionExpression"
            labelFont="text-gray-500"
            value={emotion}
            onSwitch={onEmotionSwitch}
          />

        </div>
      </InfoCard>
    );
}
