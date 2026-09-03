'use client';

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { editCronTask, updateCronTaskStatus } from "@/server/data";
import { usePersistentString } from "@/lib/use-persistent-state";
import { useToastStore } from "@/lib/toast-store";
import { useTranslation } from "react-i18next";

/**
 * The task list lives in the store, where the info stream keeps it fresh. This hook only owns the
 * expanded row and turns a click into a patch the store shows right away, taken back if the call
 * behind it fails.
 */
export function useTaskOperation(selectedTaskId?: string) {
    const { t } = useTranslation();
    const showToast = useToastStore(s => s.show);
    const tasks = useAppStore(s => s.cronTasks);
    const setCronTasks = useAppStore(s => s.setCronTasks);
    const updateCronTask = useAppStore(s => s.updateCronTask);
    const [expandedId, setExpandedId] = usePersistentString('cron.expandedId');
    const [handledSelectedTaskId, setHandledSelectedTaskId] = useState<string | undefined>();

    // A deep link opens its task once, closing it again is the user's call and not the link's.
    if (!selectedTaskId && handledSelectedTaskId) {
        setHandledSelectedTaskId(undefined);
    } else if (
        selectedTaskId && selectedTaskId !== handledSelectedTaskId
        && tasks.some(task => task.id === selectedTaskId)
    ) {
        setHandledSelectedTaskId(selectedTaskId);
        setExpandedId(selectedTaskId);
    }

    const toggle = (id: string) => {
        setExpandedId(prev => (prev === id ? undefined : id));
    };

    const toggleStatus = (id: string) => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const paused = !task.paused;
        updateCronTask({id, paused});
        updateCronTaskStatus(id, paused).catch(() => {
            updateCronTask({id, paused: !paused});
        });
    };

    const deleteTask = (id: string) => {
        // The whole list goes back on failure: a single task put back would land at the end of it.
        const previousTasks = tasks;
        updateCronTask({id, closed: true});
        if (expandedId === id) setExpandedId(undefined);
        updateCronTaskStatus(id, undefined, true).catch(() => {
            setCronTasks(previousTasks);
        });
    };

    const editTask = (id: string, fields: {title?: string; cron?: string; prompt?: string}) => {
        const task = tasks.find(one => one.id === id);
        if (!task) return;
        const patch: {id: string; title?: string; cron?: string; prompt?: string} = {id};
        const rollback: {id: string; title?: string; cron?: string; prompt?: string} = {id};
        if (fields.title !== undefined && fields.title !== task.title) {
            patch.title = fields.title;
            rollback.title = task.title;
        }
        if (fields.cron !== undefined && fields.cron !== task.cron) {
            patch.cron = fields.cron;
            rollback.cron = task.cron;
        }
        if (fields.prompt !== undefined && fields.prompt !== task.prompt) {
            patch.prompt = fields.prompt;
            rollback.prompt = task.prompt;
        }
        // Nothing beside the id is nothing that changed, and nothing to send.
        if (Object.keys(patch).length === 1) return;
        updateCronTask(patch);
        editCronTask(id, {title: patch.title, cron: patch.cron, prompt: patch.prompt}).catch(() => {
            updateCronTask(rollback);
            showToast({type: 'error', message: t('web.pages.cron.edit.failed')});
        });
    };

    return {
        tasks,
        expandedId,
        toggle,
        toggleStatus,
        deleteTask,
        editTask,
    };
}
