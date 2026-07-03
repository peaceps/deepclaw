'use client';

import { useRef } from 'react';
import {initI18n} from '@/i18n';
import { Sidebar } from './Sidebar';
import type { ManagerConfig } from '@deepclaw/config';
import type { LoopInfo } from '@deepclaw/loop-gateway';
import { useAppStore } from '@/lib/store';
import { InfoClient } from './InfoClient';
import { SSEProvider } from './SSEProvider';
import { InteractionModal } from '@/laf/interaction-modal';

type RootLayoutProps = {
  lang: string;
  manager: ManagerConfig;
  loopInfo: LoopInfo;
  children: React.ReactNode;
}

export function RootLayout({ manager, lang, loopInfo, children }: RootLayoutProps) {
  const setAgents = useAppStore(s => s.setAgents);
  const setProjects = useAppStore(s => s.setProjects);
  const i18nInitRef = useRef<boolean | null>(null);
  const storeRef = useRef<LoopInfo | null>(null);
  if (i18nInitRef.current === null) {
      initI18n(lang);
      i18nInitRef.current = true;
  }
  if (storeRef.current === null) {
    setAgents(loopInfo.agents);
    setProjects(loopInfo.projects);
    storeRef.current = loopInfo;
  }

  return (
    <SSEProvider>
      <InfoClient />
      <Sidebar
        manager={manager}
      />
      <main className="flex-1 overflow-hidden w-full h-full pt-[57px] lg:pt-0">{children}</main>
      <InteractionModal />
    </SSEProvider>
  );
}
