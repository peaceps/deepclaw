
import { InfoCard } from './InfoCard';
import { useTranslation } from "react-i18next";
import {
  User
} from 'lucide-react';

export function AgentDetailDescription({description}: {description: string}) {
    const {t} = useTranslation()

    return (<InfoCard title={t('pages.agents.details.description.title')} icon={<User size={20} />}>
        <div className="space-y-4">
        {/* 技能 */}
        <div>
            <div className="flex flex-wrap gap-2">
            {description || ''}
            </div>
        </div>
        </div>
    </InfoCard>
    );
}
