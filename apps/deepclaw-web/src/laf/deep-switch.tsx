'use client';
import {ChangeEvent} from 'react';
import { useTranslation } from 'react-i18next';
import { colorClassMap, DeepColors } from './laf-types';

const DEFAULT_FONT = 'font-semibold text-gray-900';

type DeepSwitchProps = {
    label: string;
    labelFont?: string;
    value: boolean;
    color?: DeepColors;
    onSwitch: (e: ChangeEvent<HTMLInputElement, HTMLInputElement>) => void;
    Icon?: React.ComponentType<{ size?: number; className?: string }>;
}

export function DeepSwitch({
    label,
    labelFont,
    value,
    onSwitch,
    Icon,
    color = 'blue'
}: DeepSwitchProps) {
    const {t} = useTranslation();
    const colorClass = colorClassMap[color];

    return (
        <div className="flex items-center justify-between">
            <h5 className={`text-sm ${labelFont ? labelFont : DEFAULT_FONT} flex items-center gap-2`}>
                {Icon && <Icon size={16} className="text-gray-400" /> }
                {t(label)}
            </h5>
            <label className="relative inline-flex items-center cursor-pointer">
                <input
                type="checkbox"
                checked={value}
                onChange={onSwitch}
                className="sr-only peer"
                />
                <div className={`w-11 h-6 bg-gray-200 peer-focus:ring-4 ${colorClass.peerFocusRing300}
                    rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white
                    after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                    after:bg-white after:border-gray-300 after:border after:rounded-full
                    after:h-5 after:w-5 after:transition-all ${colorClass.peerCheckedBg600}`}>
                </div>
            </label>
        </div>
    )
}
