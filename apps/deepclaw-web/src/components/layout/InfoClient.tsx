'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { getLogger } from '@/lib/logger';
import type { SSEConnectedEvent, SSEToastEvent } from '@/app/api/sse-types';
import { useSSEClient } from './SSEProvider';
import { sseUrl } from '@/lib/sse-client';
import { useToastStore } from '@/lib/toast-store';
import { ToastService } from '@/lib/toast-service';
import {
  AgentAgentInfoEvent, AgentBusyLoopsInfoEvent, AgentCronInfoEvent, AgentProjectInfoEvent,
  AgentRunningTasksInfoEvent,
  AgentRuntimeStatusInfoEvent
} from '@deepclaw/core';

const logger = getLogger('InfoClient');

export function InfoClient() {
  const sseClient = useSSEClient();
  const browserId = useAppStore(s => s.browserId);
  const updateProject = useAppStore(s => s.updateProject);
  const getAgents = useAppStore(s => s.getAgents);
  const getProjects = useAppStore(s => s.getProjects);
  const updateAgentEmployee = useAppStore(s => s.updateAgentEmployee);
  const showEmotionPopup = useAppStore(s => s.showEmotionPopup);
  const setRunningTasks = useAppStore(s => s.setRunningTasks);
  const setBusyLoops = useAppStore(s => s.setBusyLoops);
  const updateCronTask = useAppStore(s => s.updateCronTask);
  const show = useToastStore(t => t.show);

  useEffect(() => {
    const url = sseUrl(browserId);
    const unsubscribers = [
      sseClient.subscribe<SSEConnectedEvent>(
        url,
        'connected',
        ({content}) => {
          if (content !== browserId) return;
          logger.info(`Connected for ${content}.`);
        },
      ),
      sseClient.subscribe<AgentProjectInfoEvent>(
        url,
        'updateProject',
        ({content}) => {
          updateProject(content);
        },
      ),
      sseClient.subscribe<AgentAgentInfoEvent>(
        url,
        'updateAgent',
        ({content}) => {
          updateAgentEmployee({...content});
        },
      ),
      sseClient.subscribe<AgentRunningTasksInfoEvent>(
        url,
        'updateRunningTasks',
        ({content}) => {
          setRunningTasks(content);
        },
      ),
      sseClient.subscribe<AgentBusyLoopsInfoEvent>(
        url,
        'updateBusyLoops',
        ({content}) => {
          setBusyLoops(content);
        },
      ),
      sseClient.subscribe<AgentCronInfoEvent>(
        url,
        'updateCron',
        ({content}) => {
          updateCronTask(content);
        },
      ),
      sseClient.subscribe<AgentRuntimeStatusInfoEvent>(
        url,
        'updateAgentRuntime',
        ({content: {agentId, emotion, ...status}}) => {
          if (!getAgents().some(agent => agent.id === agentId)) {
            logger.warn(`Agent ${agentId} not found for runtime update.`);
            return;
          }
          // The gateway keeps the moods and the emotions, so its status is taken as it comes.
          updateAgentEmployee({ id: agentId, ...status });
          if (emotion) {
            // pop the emotion up on the agent's card in the list
            showEmotionPopup(agentId, emotion);
          }
        },
      ),
      sseClient.subscribe<SSEToastEvent>(
        url,
        'toast',
        ({content}) => {
          const {title, message, duration} = ToastService.parseToastEvent(content, getProjects() , getAgents());
          if (message) {
            show({type: 'info', title, message, duration});
          }
        },
      ),
    ];

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    sseClient, updateProject, updateAgentEmployee, showEmotionPopup, setRunningTasks, setBusyLoops,
    updateCronTask, browserId, getAgents, getProjects, show,
  ]);

  return <></>;
}
