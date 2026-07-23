import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatDate } from '@/components/component-utils';
import type { CronTask } from '@deepclaw/loop-gateway';
import { TokenUsageIcon } from '@/laf/token-usage';
import { ContentModal } from '@/laf/content-modal';

type HistoriesProps = {
    task: CronTask;
    creator: string;
};

export function Histories({ task, creator }: HistoriesProps) {
    const { t, i18n } = useTranslation();
    const [report, setReport] = useState<string | null>(null);
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
                    {task.histories.map((history, i) => (
                        <div
                            key={i}
                            onClick={() => history.finalText && setReport(history.finalText)}
                            className={`flex items-center gap-3 p-3 rounded-lg border border-gray-200
                                hover:bg-gray-50 transition-colors ${history.finalText ? 'cursor-pointer' : ''}`}
                        >
                            <div className="flex-shrink-0">
                                {history.success
                                    ? <CheckCircle2 size={18} className="text-emerald-500" />
                                    : <XCircle size={18} className="text-red-500" />}
                            </div>
                            <TokenUsageIcon tokenUsage={history.usage} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-800 font-medium">
                                        {formatDate(i18n.language, history.start)}
                                    </span>
                                    <span className="text-xs text-gray-400">·</span>
                                    <span className="text-xs text-gray-500">{creator}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {report !== null && (
                <ContentModal
                    type="markdown"
                    title={t('web.pages.cron.history.report')}
                    content={report}
                    onClose={() => setReport(null)}
                />
            )}
        </div>
    );
}
