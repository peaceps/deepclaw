import { AgentEmployee } from "@deepclaw/loop-gateway";
import { useTranslation } from "react-i18next";
import { Briefcase, Building2, CheckCircle2 } from "lucide-react";
import { moodEmojis, statusColors, statusTexts } from "../../styles-mapping";

export function AgentHeader({ agent }: { agent: AgentEmployee }) {
  
    const {t} = useTranslation();
  
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start gap-4 sm:gap-6">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center text-3xl sm:text-5xl shadow-lg">
              {agent.avatar}
            </div>
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-6 sm:h-6 rounded-full border-2 sm:border-3 border-white ${statusColors[agent.status]} shadow-sm`} />
          </div>
  
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{agent.name}</h1>
              <span className="text-xl sm:text-2xl">{moodEmojis[agent.mood]}</span>
              <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-medium text-white ${statusColors[agent.status]}`}>
                {t(statusTexts[agent.status])}
              </span>
            </div>
  
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-gray-600 mb-4 text-sm sm:text-base">
              <span className="flex items-center gap-1.5">
                <Briefcase size={14} className="sm:w-4 sm:h-4" />
                {agent.role}
              </span>
              <span className="flex items-center gap-1.5">
                <Building2 size={14} className="sm:w-4 sm:h-4" />
                {agent.department}
              </span>
            </div>
  
            {/* Stats */}
            <div className="flex gap-4 sm:gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <CheckCircle2 size={16} className="sm:w-5 sm:h-5 text-green-600" />
                </div>
                <div>
                  <div className="text-base sm:text-lg font-bold text-gray-900">{agent.stats.tasksCompleted}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
}
