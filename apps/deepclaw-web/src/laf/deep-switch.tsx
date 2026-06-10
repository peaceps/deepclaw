'use client';
import {ChangeEvent} from 'react';

type DeepSwitchProps = {
    label: string;
    value: boolean;
    onSwitch: (e: ChangeEvent<HTMLInputElement, HTMLInputElement>) => void;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
}

export function DeepSwitch({
    label,
    value,
    onSwitch,
    Icon
}: DeepSwitchProps) {

    return (
        <div className="flex items-center justify-between">
            <h5 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Icon size={16} className="text-gray-400" />
                {label}
            </h5>
            <label className="relative inline-flex items-center cursor-pointer">
                <input
                type="checkbox"
                checked={value}
                onChange={onSwitch}
                className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
        </div>
    )
}
