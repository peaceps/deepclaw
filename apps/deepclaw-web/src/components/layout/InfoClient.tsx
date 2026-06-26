'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import type { SSEConnectedEvent, SSEInfoEvent } from '@/app/api/sse-server';
import { useSSEClient } from './SSEProvider';

const logger = getLogger('InfoClient');

const INFO_SSE_KEY = 'info';
const INFO_SSE_URL = '/api/info?secret=info';

export function InfoClient() {
  const sseClient = useSSEClient();
  const updateProject = useAppStore(s => s.updateProject);
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);

  useEffect(() => {
    const unsubscribers = [
      sseClient.subscribe<Extract<SSEConnectedEvent, {sseType: 'connected'}>>(
        INFO_SSE_KEY,
        INFO_SSE_URL,
        'connected',
        ({content}) => {
          logger.info(`Connected for ${content}.`);
        },
      ),
      sseClient.subscribe<Extract<SSEInfoEvent, {sseType: 'updateProject'}>>(
        INFO_SSE_KEY,
        INFO_SSE_URL,
        'updateProject',
        ({content}) => {
          updateProject(content);
        },
      ),
      sseClient.subscribe<Extract<SSEInfoEvent, {sseType: 'updateAgent'}>>(
        INFO_SSE_KEY,
        INFO_SSE_URL,
        'updateAgent',
        ({content}) => {
          updateAgentEmployee(content.id, content);
        },
      ),
    ];

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [sseClient, updateProject, updateAgentEmployee]);

  return <></>;
}
