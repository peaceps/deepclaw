import { AgentEmployee } from "@deepclaw/loop-gateway";
import { InfoCard } from "./InfoCard";
import { TraitBadge } from "./TraitBadge";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AgentDetailPersonality({ agent }: { agent: AgentEmployee }) {
    const {t} = useTranslation();

    return (
      <InfoCard title={t('pages.agents.details.personality.title')} icon={<Heart size={20} />}>
        <div className="space-y-4">
          {/* 性格特征 */}
          <div>
            <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.personality.traits')}</label>
            <div className="flex flex-wrap gap-2">
              {agent.personality.traits.map((trait) => (
                <TraitBadge key={trait} text={trait} color="purple" />
              ))}
            </div>
          </div>
  
          {/* 沟通风格 */}
          <div>
            <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.personality.communicationStyle')}</label>
            <TraitBadge
              text={agent.personality.communicationStyle}
              color="blue"
            />
          </div>
  
          {/* 情感表达 */}
          <div>
            <label className="text-sm text-gray-500 mb-2 block">{t('pages.agents.details.personality.emotionExpression')}</label>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
              agent.personality.emotionExpression
                ? 'bg-pink-50 text-pink-700 border-pink-200'
                : 'bg-gray-100 text-gray-700 border-gray-200'
            }`}>
              {agent.personality.emotionExpression ?
                '😊 '+ t('pages.agents.details.personality.emotional') :
                '😐 ' + t('pages.agents.details.personality.rational')}
            </span>
          </div>
        </div>
      </InfoCard>
    );
}
