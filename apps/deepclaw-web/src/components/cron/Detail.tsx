import { useTranslation } from 'react-i18next';
import { Play, Pause, Trash2 } from 'lucide-react';
import type { CronTask } from '@deepclaw/core';
import { translateCron } from '@/components/component-utils';
import { SupportedLanguage } from '@deepclaw/i18n';
import { TokenUsageIcon } from '@/laf/token-usage';

type DetailProps = {
    task: CronTask;
    creator: string;
    onToggleStatus: () => void;
    onDelete: () => void;
};

export function Detail({ task, creator, onToggleStatus, onDelete }: DetailProps) {
    const { t, i18n } = useTranslation();
    return (
        <div className="lg:w-2/5 p-6 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50/50">
            <div className="space-y-4">
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                        {t('web.pages.cron.schedule')}
                    </div>
                    <div className="text-sm text-gray-800">
                        {translateCron(i18n.language as SupportedLanguage, task.cron)}
                    </div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{task.cron}</div>
                </div>
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                        {t('web.pages.cron.creator')}
                    </div>
                    <div className="text-sm text-gray-800">{creator}</div>
                </div>
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                        {t('web.pages.cron.prompt')}
                    </div>
                    <div className={`text-sm text-gray-700 bg-white rounded-lg border border-gray-200
                        p-3 leading-relaxed`}>
                        {task.prompt}
                    </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                            text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100
                            transition-colors`}
                    >
                        {!task.paused ? <Pause size={14} /> : <Play size={14} />}
                        {!task.paused ? t('web.pages.cron.actions.pause')
                            : t('web.pages.cron.actions.resume')}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                            font-medium text-red-500 border border-red-200 rounded-md
                            hover:bg-red-50 transition-colors`}
                    >
                        <Trash2 size={14} />
                        {t('web.pages.cron.actions.delete')}
                    </button>
                    <div className="ml-auto">
                        <TokenUsageIcon tokenUsage={task.usage} />
                    </div>
                </div>
            </div>
        </div>
    );
}
