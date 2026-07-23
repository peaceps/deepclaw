'use client';

import { useAppStore } from "@/lib/store";
import { useSSEClient } from "../layout/SSEProvider";
import { AgentCronInfoEvent, CronTask } from "@deepclaw/core";
import { useEffect, useState } from "react";
import { updateCronTaskStatus } from "@/server/data";

export function useSSEConnection(
    setTasks: React.Dispatch<React.SetStateAction<CronTask[]>>,
) {
    const browserId = useAppStore(s => s.browserId);
    const sseClient = useSSEClient();

    useEffect(() => {
        const INFO_SSE_URL = `/api/info?browserId=${browserId}`;
        const unsubscribers = [
          sseClient.subscribe<AgentCronInfoEvent>(
            INFO_SSE_URL,
            'updateCron',
            ({content}) => {
                setTasks(prev => {
                    const exists = prev.some(t => t.id === content.id);
                    if (exists) {
                        if (content.closed) {
                            return prev.filter(t => t.id !== content.id);
                        } else {
                            return prev.map(t => t.id === content.id ? { ...t, ...content } : t);
                        }
                    } else {
                        return [...prev, content as CronTask];
                    }
                });
            },
          ),
        ];
    
        return () => {
          unsubscribers.forEach(unsubscribe => unsubscribe());
        };
    }, [browserId, setTasks, sseClient]);
}

export function useTaskOperation(cronTasks: CronTask[]) {
    const [expandedId, setExpandedId] = useState<string | undefined>();
    const [tasks, setTasks] = useState<CronTask[]>(cronTasks);

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

    return {
        tasks,
        expandedId,
        toggle,
        toggleStatus,
        deleteTask,
        setTasks
    };
}
