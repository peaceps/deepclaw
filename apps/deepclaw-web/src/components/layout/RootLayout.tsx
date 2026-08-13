'use client';

import { useRef } from 'react';
import {initI18n} from '@/i18n';
import { Sidebar } from './Sidebar';
import type { ManagerConfig } from '@deepclaw/config';
import type { DeepclawDataInfo } from '@deepclaw/loop-gateway';
import { useAppStore } from '@/lib/store';
import { InfoClient } from './InfoClient';
import { SSEProvider } from './SSEProvider';
import { InteractionModal } from '@/laf/interaction-modal';
import { ToastContainer } from './ToastContainer';

type RootLayoutProps = {
  lang: string;
  manager: ManagerConfig;
  dataInfo: DeepclawDataInfo;
  children: React.ReactNode;
}

export function RootLayout({ manager, lang, dataInfo, children }: RootLayoutProps) {
  const setAgents = useAppStore(s => s.setAgents);
  const setProjects = useAppStore(s => s.setProjects);
  const setRunningTasks = useAppStore(s => s.setRunningTasks);
  const setBusyLoops = useAppStore(s => s.setBusyLoops);
  const setCronTasks = useAppStore(s => s.setCronTasks);
  const i18nInitRef = useRef<boolean | null>(null);
  const storeRef = useRef<DeepclawDataInfo | null>(null);
  if (i18nInitRef.current === null) {
      initI18n(lang);
      i18nInitRef.current = true;
  }
  if (storeRef.current === null) {
    setAgents(dataInfo.agents);
    setProjects(dataInfo.projects);
    setRunningTasks(dataInfo.runningTasks);
    setBusyLoops(dataInfo.busyLoops);
    setCronTasks(dataInfo.cronTasks);
    storeRef.current = dataInfo;
  }

  return (
    <SSEProvider>
      <InfoClient />
      <Sidebar
        manager={manager}
      />
      <main className="flex-1 overflow-hidden w-full h-full pt-[57px] lg:pt-0">{children}</main>
      <InteractionModal />
      <ToastContainer />
    </SSEProvider>
  );
}
