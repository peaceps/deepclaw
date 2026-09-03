import { InfoCard } from "@/laf/info-card";
import { type AgentEmployee, type CronTask } from "@deepclaw/core";
import { type SupportedLanguage } from "@deepclaw/i18n";
import { Clock } from "lucide-react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import { formatDate } from "@/components/component-utils";
import { scheduleText } from "@/components/cron/cron-words";

export function AgentDetailCrons({ agent }: { agent: AgentEmployee }) {
  const {t} = useTranslation();
  const cronTasks = useAppStore(s => s.cronTasks);
  const tasks = cronTasks.filter(task => task.creator === agent.id);

  return (
    <InfoCard title="web.pages.agents.details.crons.title" icon={<Clock size={20} />} color="amber">
      {tasks.length > 0 ? (
        // Room for about three tasks, the rest is a scroll away so the card stays a card.
        <div className="space-y-3 max-h-[320px] overflow-y-auto">
          {tasks.map(task => <CronTaskRow key={task.id} task={task} />)}
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic">
          {t('web.pages.agents.details.crons.noTask')}
        </div>
      )}
    </InfoCard>
  );
}

function CronTaskRow({task}: {task: CronTask}) {
  const {t, i18n} = useTranslation();
  const running = !task.paused;

  return (
    <Link
      href={`/cron?task=${encodeURIComponent(task.id)}`}
      className="block bg-gray-50 rounded-lg p-3 transition-colors
        hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2"
      aria-label={`${t('web.pages.agents.details.crons.title')}: ${task.title}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            running ? 'bg-emerald-500' : 'bg-gray-400'
          }`} />
          <span className="font-medium text-gray-900 truncate">{task.title}</span>
        </span>
        <span className={`text-xs font-medium whitespace-nowrap ${
          running ? 'text-emerald-600' : 'text-gray-400'
        }`}>
          {t(`web.pages.cron.status.${running ? 'running' : 'paused'}`)}
        </span>
      </div>
      <p className="text-sm text-gray-600 truncate">
        {scheduleText(i18n.language as SupportedLanguage, task.cron)}
      </p>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
        <span>{t('web.pages.cron.lastRun')}: {formatDate(i18n.language, task.lastRun)}</span>
        <span>{t('web.pages.cron.nextRun')}: {formatDate(i18n.language, task.nextRun)}</span>
      </div>
    </Link>
  );
}
