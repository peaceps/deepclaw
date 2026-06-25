'use client';

import { useTranslation } from 'react-i18next';

type ProgressBarProps = {
  value: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

const sizeClasses: Record<NonNullable<ProgressBarProps['size']>, string> = {
  sm: 'h-1.5',
  md: 'h-2',
};

export function ProgressBar({
  value,
  showLabel = true,
  size = 'sm',
  className,
}: ProgressBarProps) {
  const {t} = useTranslation();
  const safeValue = Math.min(100, Math.max(0, value));

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-500">{t('pages.projects.project.progress')}</span>
          <span className="font-medium text-gray-700">{safeValue}%</span>
        </div>
      )}
      <div className={`${sizeClasses[size]} bg-gray-200 rounded-full overflow-hidden`}>
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}
