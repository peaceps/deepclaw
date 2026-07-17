'use client';
import {useTranslation} from 'react-i18next';

export function Cron() {
    const {t} = useTranslation();
    return (
        <div>
            <div className="text-6xl mb-4">⏰</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('web.sidebar.links.cron')}</h2>
            <p className="text-sm">{t('web.common.notReady')}</p>
        </div>
    );
}
