import { useTranslation } from 'react-i18next';
import {
  Settings,
} from 'lucide-react';

export function AgentSettingsSection({title, children}: {
  title: string; children: React.ReactNode
}) {
  const {t} = useTranslation();
  return (
    <div className="space-y-4">
      <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Settings size={16} className="text-gray-400" />
        {t(title)}
      </h5>
      {children}
    </div>
  )
}
