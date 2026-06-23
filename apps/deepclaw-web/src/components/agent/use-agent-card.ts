'use client';

import { useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { AgentEmployee } from "@deepclaw/core";

export function useAgentCard({ agent, onSelect }: {
    agent: AgentEmployee;
    onSelect?: () => void;
  }) {
    
    const { selectedAgentId, setSelectedAgent } = useAppStore();
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const isSelected = selectedAgentId === agent.id;

    const cardRef = useRef<HTMLDivElement>(null);
  
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      setTooltipVisible(true);
      setSelectedAgent(agent.id);
      onSelect?.();
    };

    return {isSelected, tooltipVisible, setTooltipVisible, cardRef, handleClick};
}
