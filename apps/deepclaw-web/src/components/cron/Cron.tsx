'use client';

import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';
import { InfoBar } from '@/laf/info-bar';
import { CollapseTask } from './CollapseTask';
import { useTaskOperation } from './use-cron-hooks';

export function Cron({ selectedTaskId }: { selectedTaskId?: string }) {
    const { t } = useTranslation();
    const { tasks, expandedId, toggle, toggleStatus, deleteTask } = useTaskOperation(selectedTaskId);
    const selectedTaskRef = useRef<HTMLDivElement | null>(null);
    const scrolledTaskIdRef = useRef<string | undefined>(undefined);

    // Opening a row below the fold looks like nothing happened, so the deep link brings it into view.
    useEffect(() => {
        if (!selectedTaskId) {
            scrolledTaskIdRef.current = undefined;
            return;
        }
        if (expandedId !== selectedTaskId) return;
        if (scrolledTaskIdRef.current === selectedTaskId) return;

        const taskElement = selectedTaskRef.current;
        if (!taskElement) return;

        const frame = requestAnimationFrame(() => {
            scrolledTaskIdRef.current = selectedTaskId;
            taskElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return () => cancelAnimationFrame(frame);
    }, [expandedId, selectedTaskId, tasks]);

    return (
        <div className="h-full w-full overflow-auto p-6">
            <div className="mb-4">
                <h1 className="text-2xl font-bold text-gray-800">{t('web.sidebar.links.cron')}</h1>
            </div>
            <InfoBar message={t('web.pages.cron.tip')} />

            <div className="space-y-3">
                {tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400">
                        <Clock size={40} className="mx-auto mb-3 opacity-40" />
                        <p className="text-sm">{t('web.pages.cron.empty')}</p>
                    </div>
                ) : tasks.map(task => (
                    <div key={task.id} ref={task.id === selectedTaskId ? selectedTaskRef : undefined}>
                        <CollapseTask
                            task={task}
                            isExpanded={expandedId === task.id}
                            onToggle={() => toggle(task.id)}
                            onToggleStatus={() => toggleStatus(task.id)}
                            onDelete={() => deleteTask(task.id)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
