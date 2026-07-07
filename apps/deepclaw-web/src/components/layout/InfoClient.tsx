'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import type { SSEAgentInfoEvent, SSEConnectedEvent, SSEProjectInfoEvent } from '@/app/api/sse-types';
import { useSSEClient } from './SSEProvider';

const logger = getLogger('InfoClient');

export function InfoClient() {
  const sseClient = useSSEClient();
  const browserId = useAppStore(s => s.browserId);
  const updateProject = useAppStore(s => s.updateProject);
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);

  useEffect(() => {
    const INFO_SSE_URL = `/api/info?browserId=${browserId}`;
    const unsubscribers = [
      sseClient.subscribe<SSEConnectedEvent>(
        INFO_SSE_URL,
        'connected',
        ({content}) => {
          if (content !== browserId) return;
          logger.info(`Connected for ${content}.`);
        },
      ),
      sseClient.subscribe<SSEProjectInfoEvent>(
        INFO_SSE_URL,
        'updateProject',
        ({content}) => {
          updateProject(content);
        },
      ),
      sseClient.subscribe<SSEAgentInfoEvent>(
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
  }, [sseClient, updateProject, updateAgentEmployee, browserId]);

  return <></>;
}
