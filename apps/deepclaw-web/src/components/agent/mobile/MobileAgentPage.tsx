'use client';

import { useState } from "react";
import { AgentEmployee, getLoopId } from "@deepclaw/core";
import { MobileAgentHeader } from "./MobileAgentHeader";
import { MobileView } from "@/component-types";
import { AgentList } from "../AgentList";
import { AgentDetail } from "../details/AgentDetail";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useAppStore } from "@/lib/store";

export function MobileAgentPage({selectedAgent}: {
    selectedAgent?: AgentEmployee;
}) {
    const [mobileView, setMobileView] = useState<MobileView>('list');
    const [answeredCall, setAnsweredCall] = useState(0);
    const openChatCall = useAppStore(s => s.openChatCall);

    // One view at a time: a chat called for from elsewhere is only shown by leaving the list for it.
    const calledSeq = selectedAgent && openChatCall?.loopId === getLoopId('agent', selectedAgent.id)
        ? openChatCall.seq
        : 0;
    if (calledSeq && calledSeq !== answeredCall) {
        setAnsweredCall(calledSeq);
        setMobileView('chat');
    }

    return (
    <>
        <MobileAgentHeader mobileView={mobileView} setMobileView={setMobileView}/>

        <div className="flex-1 overflow-hidden w-full">
          {/* Agent List View */}
          {mobileView === 'list' && (
            <div className="h-full bg-gray-50 overflow-hidden">
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
                  projectId=""
                  agent={selectedAgent}
                  fitContainer
                  sessionActions
                />
            </div>
          )}
        </div>
    </>
    );
}
