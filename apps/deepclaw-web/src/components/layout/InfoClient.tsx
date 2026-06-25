'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import type { SSEConnectedEvent, SSEInfoEvent } from '@/app/api/sse-server';

const logger = getLogger('InfoClient');

export function InfoClient() {
  const updateProject = useAppStore(s => s.updateProject);
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);

  useEffect(() => {
    const eventSource = new EventSource('/api/info?secret=info');

    eventSource.addEventListener('connected', (event) => {
      const {clientId} = JSON.parse(event.data) as Extract<SSEConnectedEvent, {sseType: 'connected'}>;
      logger.info(`Connected for ${clientId}.`);
    });

    eventSource.addEventListener('updateProject', (event) => {
      const {content} = JSON.parse(event.data) as Extract<SSEInfoEvent, {sseType: 'updateProject'}>;
      updateProject(content);
    });

    eventSource.addEventListener('updateAgent', (event) => {
      const {content} = JSON.parse(event.data) as Extract<SSEInfoEvent, {sseType: 'updateAgent'}>;
      updateAgentEmployee(content.id, content);
    });

    return () => eventSource.close();
  }, [updateProject, updateAgentEmployee]);

  return <></>;
}
