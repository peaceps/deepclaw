'use client';

import { useState } from "react";
import { AgentEmployee } from "@deepclaw/core";
import { MobileAgentHeader } from "./MobileAgentHeader";
import { MobileView } from "./mobile-view";
import { AgentList } from "../AgentList";
import { AgentDetail } from "../details/AgentDetail";
import { ChatPanel } from "@/components/chat/ChatPanel";

export function MobileAgentPage({selectedAgent}: {
    selectedAgent?: AgentEmployee;
}) {
    const [mobileView, setMobileView] = useState<MobileView>('list');

    return (
    <>
        <MobileAgentHeader mobileView={mobileView} setMobileView={setMobileView}/>

        <div className="flex-1 overflow-hidden w-full">
          {/* Agent List View */}
          {mobileView === 'list' && (
            <div className="h-full bg-gray-50 p-4 overflow-y-auto">
              <AgentList onSelect={() => setMobileView('detail')} />
            </div>
          )}

          {/* Agent Detail View */}
          {mobileView === 'detail' && selectedAgent && (
            <div className="h-full overflow-hidden">
              <AgentDetail agent={selectedAgent} />
            </div>
          )}

          {/* Chat View */}
          {mobileView === 'chat' && selectedAgent && (
            <div className="h-full bg-white overflow-hidden">
                <ChatPanel
                  from={'agent'}
                  agent={selectedAgent}
                />
            </div>
          )}
        </div>
    </>
    );
}
