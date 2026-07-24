import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate } from '@/components/component-utils';
import type { CronJobHistory, CronTask } from '@deepclaw/core';
import { getCronHistories } from '@/server/data';
import { TokenUsageIcon } from '@/laf/token-usage';
import { TaskOutput } from '@/laf/task-output';

const PAGE_SIZE = 10;
const SCROLL_THRESHOLD = 80;

type HistoriesProps = {
    task: CronTask;
};

export function Histories({ task }: HistoriesProps) {
    const { t, i18n } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    // Older histories loaded on demand (newest-first), beyond the live SSE window.
    const [older, setOlder] = useState<CronJobHistory[]>([]);
    const [hasMore, setHasMore] = useState(task.histories.length >= PAGE_SIZE);
    const [loading, setLoading] = useState(false);

    // The live window comes straight from the task prop (kept fresh via SSE), newest-first.
    const live = [...task.histories].reverse();
    const newestStart = task.histories[task.histories.length - 1]?.start;
    const items = [...live, ...older];

    // On a new execution, reset pagination and scroll back to the top.
    useEffect(() => {
        setOlder([]);
        setHasMore(task.histories.length >= PAGE_SIZE);
        scrollRef.current?.scrollTo({ top: 0 });
    }, [newestStart, task.histories.length]);

    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;
        const cursor = items[items.length - 1]?.start;
        if (cursor === undefined) return;
        setLoading(true);
        try {
            const page = await getCronHistories(task.id, cursor, PAGE_SIZE);
            setOlder(prev => [...prev, ...page]);
            if (page.length < PAGE_SIZE) setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [task.id, items, loading, hasMore]);

    const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD) {
            loadMore();
        }
    }, [loadMore]);

    return (
        <div className="lg:w-3/5 p-6">
            <div className="text-sm font-medium text-gray-700 mb-3">
                {t('web.pages.cron.history.title')}
            </div>
            {items.length === 0 ? (
                <div className="text-center text-gray-400 py-8 text-sm">
                    {t('web.pages.cron.history.empty')}
                </div>
            ) : (
                <div ref={scrollRef} onScroll={onScroll} className="space-y-2 max-h-[400px] overflow-y-auto">
                    {items.map((history) => (
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
                    {loading && (
                        <div className="flex justify-center py-2">
                            <Loader2 size={18} className="text-gray-400 animate-spin" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
