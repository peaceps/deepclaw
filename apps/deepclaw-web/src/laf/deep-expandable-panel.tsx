'use client';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type PanelHeaderProps = {
  name: string;
  title: string;
  description: string;
  expanded: boolean;
  error?: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  onToggle: (name: string) => void;
}

export function PanelHeader({
  name,
  title,
  description,
  Icon,
  error,
  expanded,
  onToggle,
}: PanelHeaderProps) {
  const {t} = useTranslation();
  return (
    <button
      onClick={() => onToggle(name)}
      className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
          <Icon size={20} className="text-blue-600" />
        </div>
        <div>
          <h3 className="text-left font-semibold text-gray-900">{t(title)}</h3>
          <p className="text-sm text-gray-500">{t(description)}</p>
          {error && (
              <p className="ml-1 mt-1 text-xs text-red-600">{t(error)}</p>
          )}
        </div>
      </div>
      {expanded ? (
        <ChevronDown size={20} className="text-gray-400" />
      ) : (
        <ChevronRight size={20} className="text-gray-400" />
      )}
    </button>
  );
}

export function DeepExpandablePanel({
    name,
    title,
    description,
    expanded,
    onToggle,
    Icon,
    error,
    children,
}: {
    name: string,
    title: string;
    description: string;
    expanded: boolean;
    onToggle: (name: string) => void;
    error?: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
    children: React.ReactNode;
}) {
    return (
        <DeepCustomHeaderExpandablePanel
          CustomHeader={PanelHeader}
          customHeaderProps={{
            name, title, description, error, Icon, expanded, onToggle
          }}
        >
          {children}
        </DeepCustomHeaderExpandablePanel>
    );
}

export function DeepCustomHeaderExpandablePanel<P extends { name: string; expanded: boolean; onToggle: (name: string) => void }>({
    children,
    CustomHeader,
    customHeaderProps,
}: {
    children: React.ReactNode;
    CustomHeader: React.ComponentType<P>;
    customHeaderProps: P;
}) {
    return (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <CustomHeader {...customHeaderProps}/>
          {customHeaderProps.expanded && (
            children
          )}
        </div>
    );
}
