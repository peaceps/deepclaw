'use client';

import { useAppStore } from '@/lib/store';
import { MobileAgentPage } from './mobile/MobileAgentPage';
import { DesktopAgentPage } from './DesktopAgentPage';

export function AgentPage() {
  const { getSelectedAgent } = useAppStore();

  const selectedAgent = getSelectedAgent();

  return (
    <div className="h-full flex">
      {/* Desktop Layout */}
      <div className="hidden lg:flex h-full w-full">
        <DesktopAgentPage selectedAgent={selectedAgent}/>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden flex-1 flex flex-col h-full overflow-hidden">
        <MobileAgentPage selectedAgent={selectedAgent}/>
      </div>
    </div>
  );
}
