'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { InfoBar } from '@/laf/info-bar';
import type { CronTask } from '@deepclaw/loop-gateway';
import { updateCronTaskStatus } from '@/server/data';
import { CollapseTask } from './CollapseTask';

type CronProperties = {
    cronTasks: CronTask[];
}

export function Cron({ cronTasks }: CronProperties) {
    const { t } = useTranslation();
    const [tasks, setTasks] = useState<CronTask[]>(cronTasks);
    const [expandedId, setExpandedId] = useState<string | undefined>();

    const toggle = (id: string) => {
        setExpandedId(prev => (prev === id ? undefined : id));
    };

    const toggleStatus = (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const newPaused = !task.paused;
        setTasks(prev => prev.map(t => t.id === id ? { ...t, paused: newPaused } : t));
        updateCronTaskStatus(id, newPaused).catch(() => {
            setTasks(prev => prev.map(t => t.id === id ? { ...t, paused: !newPaused } : t));
        });
    };

    const deleteTask = (id: string) => {
        const previousTasks = tasks;
        setTasks(prev => prev.filter(task => task.id !== id));
        if (expandedId === id) setExpandedId(undefined);
        updateCronTaskStatus(id, undefined, true).catch(() => {
            setTasks(previousTasks);
        });
    };

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
