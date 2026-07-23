import { useTranslation } from 'react-i18next';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDate, translateCron } from '@/components/component-utils';
import type { CronTask } from '@deepclaw/loop-gateway';
import { SupportedLanguage } from '@deepclaw/i18n';

function getStatusStyle(task: CronTask): { color: string; bg: string; labelKey: string } {
    return !task.paused
        ? { color: 'text-emerald-600', bg: 'bg-emerald-500', labelKey: 'web.pages.cron.status.running' }
        : { color: 'text-gray-400', bg: 'bg-gray-400', labelKey: 'web.pages.cron.status.paused' };
}

type TaskProps = {
    task: CronTask;
    creator: string;
    isExpanded: boolean;
};

export function Task({ task, creator, isExpanded }: TaskProps) {
    const { t, i18n } = useTranslation();
    const statusCfg = getStatusStyle(task);
    return (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                <div className="text-gray-400 flex-shrink-0">
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </div>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500
                    to-purple-600 flex items-center justify-center text-white flex-shrink-0`}>
                    <Clock size={20} />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate">
                        {task.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                        <span>{t('web.pages.cron.creator')}: {creator}</span>
                        <span>·</span>
                        <span>{translateCron(i18n.language as SupportedLanguage, task.cron)}</span>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                <div className="text-right min-w-[100px]">
                    <div className="text-xs text-gray-400">{t('web.pages.cron.lastRun')}</div>
                    <div className="text-sm text-gray-700">{formatDate(i18n.language, task.lastRun)}</div>
                </div>
                <div className="text-right min-w-[100px]">
                    <div className="text-xs text-gray-400">{t('web.pages.cron.nextRun')}</div>
                    <div className="text-sm text-gray-700">{formatDate(i18n.language, task.nextRun)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${statusCfg.bg}`} />
                    <span className={`text-sm font-medium ${statusCfg.color}`}>
                        {t(statusCfg.labelKey)}
                    </span>
                </div>
            </div>
        </div>
    );
}
