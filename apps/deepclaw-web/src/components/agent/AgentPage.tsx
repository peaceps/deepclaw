'use client';

import { useAppStore } from '@/lib/store';
import { MobileAgentPage } from './mobile/MobileAgentPage';
import { DesktopAgentPage } from './DesktopAgentPage';
import { useWideLayout } from '@/lib/use-media-query';

/**
 * One layout at a time, rather than both with one hidden: each of them holds a chat of the same
 * loop, and a hidden chat still listens to that loop and answers for it.
 */
export function AgentPage() {
  const selectedAgent = useAppStore(s => s.agents.find(a => a.id === s.selectedAgentId));
  const wideLayout = useWideLayout();

  return (
    <div className="h-full flex">
      {wideLayout ? (
        <div className="flex h-full w-full">
          <DesktopAgentPage selectedAgent={selectedAgent}/>
        </div>
      ) : (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <MobileAgentPage selectedAgent={selectedAgent}/>
        </div>
      )}
    </div>
  );
}
