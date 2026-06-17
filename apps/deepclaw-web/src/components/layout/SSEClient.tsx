'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import type { Task, Project, AgentEmployee } from '@deepclaw/core';

export function SSEClient() {
  const {updateProjectTask, updateAgentEmployee} = useAppStore();

  useEffect(() => {
    const eventSource = new EventSource('/api/sse?secret=sse');

    eventSource.addEventListener('connected', (event) => {
      const {clientId} = JSON.parse(event.data) as {clientId: string};
      // Todo
      console.info(`Connected for ${clientId}.`);
    });

    eventSource.addEventListener('updateProject', (event) => {
      const {content} = JSON.parse(event.data) as {content: Project<Task>};
      updateProjectTask(content);
    });

    eventSource.addEventListener('updateAgent', (event) => {
      const {content} = JSON.parse(event.data) as {content: Partial<AgentEmployee> & {id: string}};
      updateAgentEmployee(content.id, content);
    });

    return () => eventSource.close();
  }, [updateProjectTask, updateAgentEmployee]);

  return <></>;
}
