'use client';
import {useTranslation} from 'react-i18next';

export function MessageCenter() {
    const {t} = useTranslation();
    return (
        <div>
            <div className="text-6xl mb-4">💬</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('sidebar.links.chat')}</h2>
            <p className="text-sm">{t('common.notReady')}</p>
        </div>
    );
}
