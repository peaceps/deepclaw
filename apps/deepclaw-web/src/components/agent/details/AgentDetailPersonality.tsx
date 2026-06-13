import { AgentEmployee } from "@deepclaw/core";
import { InfoCard } from "./InfoCard";
import { TraitBadge } from "./TraitBadge";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeepSwitch } from "@/laf/deep-switch";
import { useCallback, useState } from "react";

export function AgentDetailPersonality({ agent }: { agent: AgentEmployee }) {
    const {t} = useTranslation();
    const [personality, setPersonality] = useState({personalities: agent.personalities, emotion: agent.emotion});
    const onEmotionSwitch = useCallback(() => {
      setPersonality({...personality, emotion: !personality.emotion})
    }, [personality]);

    return (
      <InfoCard title={t('pages.agents.details.personality.title')} icon={<Heart size={20} />}>
        <div className="space-y-4">
          {/* 性格特征 */}
          <div>
            <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.personality.traits')}</label>
            <div className="flex flex-wrap gap-2">
              {personality.personalities.map((p) => (
                <TraitBadge key={p} text={p} color="purple" />
              ))}
            </div>
          </div>
  
          {/* 情感表达 */}
          <DeepSwitch 
            label={t('pages.agents.details.personality.emotionExpression')}
            labelFont="text-gray-500"
            value={personality.emotion}
            onSwitch={onEmotionSwitch}
          />

        </div>
      </InfoCard>
    );
}
