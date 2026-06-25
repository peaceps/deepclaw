import { AgentEmployee } from "@deepclaw/core";
import { avatarBG, statusColors } from "../styles-mapping";
import { AgentTooltip } from "./AgentTooltip";
import { useAgentCard } from "./use-agent-card";
import { deriveAgentSummary, useAppStore } from "@/lib/store";

export function AgentCollapsedCard({
    agent, onSelect
 }: {
    agent: AgentEmployee
    onSelect?: () => void;
}) {
    const projects = useAppStore(s => s.projects);
    const {isSelected, tooltipVisible, setTooltipVisible, cardRef, handleClick} =
        useAgentCard({ agent, onSelect });
    const { status: agentStatus } = deriveAgentSummary(agent, projects);

    return (
      <>
        <div
            ref={cardRef}
            onClick={handleClick}
            title={agent.name}
            className={`
                flex flex-col items-center gap-1 p-2 rounded-xl border-2 cursor-pointer transition-all
                ${isSelected ? 'border-blue-500 bg-blue-50' :
                    'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
            `}
        >
            <div className="relative">
                <div className={`w-10 h-10 rounded-full ${avatarBG} flex items-center
                    justify-center text-xl`}>
                    {agent.avatar}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2
                    border-white ${statusColors[agentStatus]}`} />
            </div>
            <span className="w-full text-xs text-center text-gray-700 truncate">{agent.name}</span>
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
