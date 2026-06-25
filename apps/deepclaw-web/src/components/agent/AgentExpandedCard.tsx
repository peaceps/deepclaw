import type { AgentEmployee } from "@deepclaw/core";
import { avatarBG, moodEmojis, statusColors } from "../styles-mapping";
import { AgentTooltip } from "./AgentTooltip";
import { useTranslation } from "react-i18next";
import { useAgentCard } from "./use-agent-card";
import { AlarmClock, CheckCircle2, Clock } from "lucide-react";
import { deriveAgentSummary, useAppStore } from "@/lib/store";

export function AgentExpandedCard({
    agent, onSelect
 }: {
    agent: AgentEmployee;
    onSelect?: () => void;
}) {
    const projects = useAppStore(s => s.projects);
    const {isSelected, tooltipVisible, setTooltipVisible, cardRef, handleClick} =
        useAgentCard({ agent, onSelect });
    const {t} = useTranslation();
    const { status: agentStatus, stats: projectStats } = deriveAgentSummary(agent, projects);

    return (
        <>
          <div
            ref={cardRef}
            onClick={handleClick}
            className={`
              p-4 rounded-xl border-2 cursor-pointer transition-all
              ${isSelected ? 'border-blue-500 bg-blue-50' :
                'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
            `}
          >
            <div className="flex items-start gap-3">
              <div className="relative">
                <div className={`w-12 h-12 rounded-full ${avatarBG} flex
                  items-center justify-center text-2xl`}>
                  {agent.avatar}
                </div>
                <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full
                  border-2 border-white ${statusColors[agentStatus]}`} />
              </div>
    
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
                  <span className="text-sm">{moodEmojis[agent.mood]}</span>
                </div>
                <p className="text-sm text-gray-500">{agent.role}</p>
              </div>
            </div>
    
            <div className="mt-3 flex items-end justify-between text-xs">
              <span className={`px-2 py-1 rounded-full
                ${statusColors[agentStatus].replace('bg-', 'bg-opacity-20 bg-')} text-white`}>
                {t(`pages.agents.status.${agentStatus}`)}
              </span>
              <div className="text-gray-400 flex justify-between gap-2">
                <span className="text-gray-400"><AlarmClock size={14} className="inline mr-1 mb-1"/>{projectStats.todo}</span>
                <span className="text-sky-500"><Clock size={14} className="inline mr-1 mb-1"/>{projectStats.ongoing}</span>
                <span className="text-lime-600"><CheckCircle2 size={14} className="inline mr-1 mb-1"/>{projectStats.done}</span>
              </div>
            </div>
          </div>
    
          <AgentTooltip
            agent={agent}
            visible={tooltipVisible}
            anchorRef={cardRef}
            onClose={() => setTooltipVisible(false)}
          />
        </>
    );
}
