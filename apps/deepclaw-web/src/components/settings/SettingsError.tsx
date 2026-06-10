import { type ValidationResult } from '@/server/configs';
import { useTranslation } from 'react-i18next';

export function SettingsError({validationResult}: {validationResult: ValidationResult}) {
    const {t} = useTranslation();
    const validationErrors = validationResult.errors;
    return validationErrors.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-600 text-xs font-bold">!</span>
            </div>
            <div className="flex-1">
                <h3 className="font-semibold text-red-800 text-sm">
                {validationErrors.length} {t('pages.settings.errors.total')}
                </h3>
                <div className="mt-2 space-y-1">
                {(() => {
                    const summary = validationResult.summary;
                    return (
                    <>
                        {summary.uiErrorCount > 0 && (
                            <p className="text-red-700 text-xs">• {t('pages.settings.errors.ui', {count: summary.uiErrorCount})}</p>
                        )}
                        {summary.agentErrorCount > 0 && (
                            <p className="text-red-700 text-xs">
                                • {t('pages.settings.errors.agents', {agentCount: summary.affectedAgents, errorCount: summary.agentErrorCount})}
                            </p>
                        )}
                    </>
                    );
                })()}
                </div>
            </div>
        </div>
    </div>);
}