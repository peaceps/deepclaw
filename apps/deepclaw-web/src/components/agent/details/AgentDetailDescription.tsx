import { InfoCard } from '@/laf/info-card';
import {
  User
} from 'lucide-react';

export function AgentDetailDescription({description}: {description: string}) {

    return (<InfoCard title="pages.agents.details.description.title" icon={<User size={20} />}>
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
