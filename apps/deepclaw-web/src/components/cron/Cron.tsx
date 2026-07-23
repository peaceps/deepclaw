'use client';

import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { InfoBar } from '@/laf/info-bar';
import type { CronTask } from '@deepclaw/core';
import { CollapseTask } from './CollapseTask';
import { useSSEConnection, useTaskOperation } from './use-cron-hooks';

type CronProperties = {
    cronTasks: CronTask[];
}

export function Cron({ cronTasks }: CronProperties) {
    const { t } = useTranslation();
    const { tasks, expandedId, toggle, toggleStatus, deleteTask, setTasks } = useTaskOperation(cronTasks);
    useSSEConnection(setTasks);

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
                    <CollapseTask
                        key={task.id}
                        task={task}
                        isExpanded={expandedId === task.id}
                        onToggle={() => toggle(task.id)}
                        onToggleStatus={() => toggleStatus(task.id)}
                        onDelete={() => deleteTask(task.id)}
                    />
                ))}
            </div>
        </div>
    );
}
