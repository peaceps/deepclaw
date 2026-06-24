import type { AgentEmployee, AgentSoulIdentity } from "@deepclaw/core";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { BriefcaseBusiness, CheckCircle2, Pencil } from "lucide-react";
import { avatarBG, moodEmojis, statusColors } from "../../styles-mapping";
import { EmojiPicker } from "@/laf/emoji-picker";

export function AgentHeader({ agent, onUpdate }: {
    agent: AgentEmployee;
    onUpdate: (id: string, patch: Partial<AgentSoulIdentity>) => void;
}) {
    const {t} = useTranslation();
    const [editingRole, setEditingRole] = useState(false);
    const [roleDraft, setRoleDraft] = useState(agent.role);

    const onAvatarSelect = useCallback((avatar: string) => {
      onUpdate(agent.id, { avatar });
    }, [onUpdate, agent.id]);

    const startEditRole = useCallback(() => {
      setRoleDraft(agent.role);
      setEditingRole(true);
    }, [agent.role]);

    const saveRole = useCallback(() => {
      const next = roleDraft.trim();
      if (next && next !== agent.role) {
        onUpdate(agent.id, { role: next });
      }
      setEditingRole(false);
    }, [roleDraft, agent.role, agent.id, onUpdate]);

    const onRoleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRole();
      } else if (e.key === 'Escape') {
        setEditingRole(false);
      }
    }, [saveRole]);

    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start gap-4 sm:gap-6">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {/* Mobile: read-only */}
            <div className={`sm:hidden w-16 h-16 rounded-2xl ${avatarBG} flex items-center justify-center text-3xl shadow-lg`}>
              {agent.avatar}
            </div>
            {/* Desktop: editable */}
            <EmojiPicker
              value={agent.avatar}
              onSelect={onAvatarSelect}
              title={t('pages.agents.details.header.changeAvatar')}
              className={`hidden sm:flex w-24 h-24 rounded-2xl ${avatarBG} items-center justify-center text-5xl shadow-lg`}
            />
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 sm:w-6 sm:h-6 rounded-full border-2 sm:border-3 border-white ${statusColors[agent.status]} shadow-sm pointer-events-none`} />
          </div>
  
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{agent.name}</h1>
              <span className="text-xl sm:text-2xl">{moodEmojis[agent.mood]}</span>
              <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-medium text-white ${statusColors[agent.status]}`}>
                {t(`pages.agents.status.${agent.status}`)}
              </span>
            </div>
  
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-gray-600 mb-4 text-sm sm:text-base">
              <span className="flex items-center gap-1.5">
                <BriefcaseBusiness size={14} className="sm:w-4 sm:h-4 flex-shrink-0" />
                {editingRole ? (
                  <input
                    autoFocus
                    type="text"
                    value={roleDraft}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    onKeyDown={onRoleKeyDown}
                    onBlur={saveRole}
                    className="px-2 py-0.5 rounded-md border border-gray-300 bg-white
                               focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400 outline-none
                               text-sm sm:text-base min-w-[120px] max-w-[220px]"
                  />
                ) : (
                  <span className="group inline-flex items-center gap-1.5">
                    {agent.role}
                    <button
                      type="button"
                      onClick={startEditRole}
                      title={t('pages.agents.details.header.editRole')}
                      className="hidden sm:inline-flex text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                    >
                      <Pencil size={13} className="sm:w-3.5 sm:h-3.5" />
                    </button>
                  </span>
                )}
              </span>
            </div>
  
            {/* Stats */}
            <div className="flex gap-4 sm:gap-6">
              <div className="flex items-center gap-2">
                <div
                  title={t('pages.agents.details.header.projectsCompleted')}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-50 flex items-center justify-center"
                >
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
