'use client';

import { AgentEmployee } from "@deepclaw/core";
import { avatarBG, statusColors } from '../styles-mapping';
import { deriveAgentSummary, useAppStore } from "@/lib/store";

type ChatHeaderProps = {
  agent: AgentEmployee;
};

export function ChatHeader({ agent }: ChatHeaderProps) {
  const projects = useAppStore(s => s.projects);
  const { status: agentStatus } = deriveAgentSummary(agent, projects);
  return (
    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-full ${avatarBG} flex items-center justify-center text-xl`}>
        {agent.avatar}
      </div>
      <div>
        <div className={`w-2 h-2 mr-2 pt-1 rounded-full inline-block ${statusColors[agentStatus]}`} />
        <h3 className="font-semibold text-gray-900 inline-block">{agent.name}</h3>
        <p className="text-xs text-gray-500">{agent.role}</p>
      </div>
    </div>
  );
}
