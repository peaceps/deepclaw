import { useTranslation } from 'react-i18next';
import { Clock, ChevronDown, ChevronRight, User } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { formatDate, translateCron } from '@/components/component-utils';
import type { AgentEmployee, CronTask } from '@deepclaw/core';
import { SupportedLanguage } from '@deepclaw/i18n';
import { TokenUsageIcon } from '@/laf/token-usage';
import { TaskOwnerTooltip } from '../projects/TaskOwnerTooltip';

type TaskProps = {
    task: CronTask;
    agent?: AgentEmployee;
    isExpanded: boolean;
};

export function Task({ task, agent, isExpanded }: TaskProps) {
    const { t, i18n } = useTranslation();
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const creatorRef = useRef<HTMLDivElement>(null);

    const handleCreatorClick = useCallback((e: React.MouseEvent) => {
        if (!agent) return;
        e.stopPropagation();
        setTooltipVisible(true);
    }, [agent]);

    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                <div className="text-gray-400 flex-shrink-0">
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </div>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-300
                    to-orange-600 flex items-center justify-center text-white flex-shrink-0`}>
                    <Clock size={20} />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate">
                        {task.title}
                    </h3>
                    <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                        <span>{translateCron(i18n.language as SupportedLanguage, task.cron)}</span>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                <div
                    ref={creatorRef}
                    onClick={handleCreatorClick}
                    className={`flex items-center gap-1.5 text-sm bg-purple-50 px-2 py-1
                        rounded-lg transition-colors ${
                        agent ? 'cursor-pointer hover:bg-purple-100 max-sm:pointer-events-none' : ''
                    }`}
                >
                    <User size={16} className="text-violet-500" />
                    <span className="text-gray-500">{t('web.pages.cron.creator')}:</span>
                    <span className="font-medium text-violet-500">{agent?.name || task.creator}</span>
                </div>
                <div className="text-right min-w-[100px]">
                    <div className="text-xs text-gray-400">{t('web.pages.cron.lastRun')}</div>
                    <div className="text-sm text-gray-700">{formatDate(i18n.language, task.lastRun)}</div>
                </div>
                <div className="text-right min-w-[100px]">
                    <div className="text-xs text-gray-400">{t('web.pages.cron.nextRun')}</div>
                    <div className="text-sm text-gray-700">{formatDate(i18n.language, task.nextRun)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${!task.paused ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                    <span className={`text-sm font-medium ${!task.paused ? 'text-emerald-600': 'text-gray-400'}`}>
                        {t(`web.pages.cron.status.${!task.paused ? 'running' : 'paused'}`)}
                    </span>
                </div>
                <div className="ml-auto">
                    <TokenUsageIcon tokenUsage={task.usage} />
                </div>
            </div>
            {agent && <TaskOwnerTooltip
                agent={agent}
                visible={tooltipVisible}
                anchorRef={creatorRef}
                onClose={() => setTooltipVisible(false)}
            />}
        </div>
    );
}
