'use client';

interface TraitBadgeProps {
    text: string;
    color?: 'blue' | 'purple' | 'green' | 'orange' | 'gray';
  }

export function TraitBadge({ text, color = 'blue' }: TraitBadgeProps) {
    const colorClasses = {
      blue: 'bg-blue-50 text-blue-700 border-blue-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
      green: 'bg-green-50 text-green-700 border-green-200',
      orange: 'bg-orange-50 text-orange-700 border-orange-200',
      gray: 'bg-gray-100 text-gray-700 border-gray-200',
    };
  
    return (
      <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${colorClasses[color]}`}>
        {text}
      </span>
    );
}
