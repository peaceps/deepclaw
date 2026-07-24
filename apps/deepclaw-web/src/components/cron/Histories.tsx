import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { formatDate } from '@/components/component-utils';
import type { CronTask } from '@deepclaw/core';
import { TokenUsageIcon } from '@/laf/token-usage';
import { TaskOutput } from '@/laf/task-output';

type HistoriesProps = {
    task: CronTask;
};

export function Histories({ task }: HistoriesProps) {
    const { t, i18n } = useTranslation();

    return (
        <div className="lg:w-3/5 p-6">
            <div className="text-sm font-medium text-gray-700 mb-3">
                {t('web.pages.cron.history.title')}
            </div>
            {task.histories.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">
                    {t('web.pages.cron.history.empty')}
                </div>
            ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {[...task.histories].reverse().map((history) => (
                        <div
                            key={history.start}
                            className={`flex items-center gap-3 p-3 rounded-lg border border-gray-200
                                hover:bg-gray-50 transition-colors`}
                        >
                            <div className="flex-shrink-0">
                                {history.status === 'running'
                                    ? <Loader2 size={18} className="text-emerald-500 animate-spin" />
                                    : (
                                        history.status === 'success'
                                        ? <CheckCircle2 size={18} className="text-emerald-500" />
                                        : <XCircle size={18} className="text-red-500" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-800 font-medium">
                                        {formatDate(i18n.language, history.start)}
                                    </span>
                                </div>
                            </div>
                            {history.output && <TaskOutput output={history.output} title={task.title} />}
                            {history.status !== 'running' && <TokenUsageIcon tokenUsage={history.usage} />}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
