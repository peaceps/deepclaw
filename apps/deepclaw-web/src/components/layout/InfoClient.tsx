'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import { SSEInfoEvent } from '@/app/api/sse-server';

const logger = getLogger('InfoClient');

export function InfoClient() {
  const {updateProject, updateAgentEmployee} = useAppStore();

  useEffect(() => {
    const eventSource = new EventSource('/api/info?secret=info');

    eventSource.addEventListener('connected', (event) => {
      const {clientId} = JSON.parse(event.data) as {clientId: string};
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
