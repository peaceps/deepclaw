'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import type { SSEConnectedEvent, SSEToastEvent } from '@/app/api/sse-types';
import { useSSEClient } from './SSEProvider';
import { useToastStore } from '@/lib/toast-store';
import { ToastService } from '@/lib/toast-service';
import { AgentAgentInfoEvent, AgentProjectInfoEvent } from '@deepclaw/core';

const logger = getLogger('InfoClient');

export function InfoClient() {
  const sseClient = useSSEClient();
  const browserId = useAppStore(s => s.browserId);
  const updateProject = useAppStore(s => s.updateProject);
  const getAgents = useAppStore(s => s.getAgents);
  const getProjects = useAppStore(s => s.getProjects);
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);
  const show = useToastStore(t => t.show);

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
      sseClient.subscribe<AgentProjectInfoEvent>(
        INFO_SSE_URL,
        'updateProject',
        ({content}) => {
          updateProject(content);
        },
      ),
      sseClient.subscribe<AgentAgentInfoEvent>(
        INFO_SSE_URL,
        'updateAgent',
        ({content}) => {
          updateAgentEmployee(content.id, content);
        },
      ),
      sseClient.subscribe<SSEToastEvent>(
        INFO_SSE_URL,
        'toast',
        ({content}) => {
          const {title, message} = ToastService.parseToastEvent(content, getProjects() , getAgents());
          if (message) {
            show({type: 'info', title, message});
          }
        },
      ),
    ];

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [sseClient, updateProject, updateAgentEmployee, browserId, getAgents, getProjects, show]);

  return <></>;
}
