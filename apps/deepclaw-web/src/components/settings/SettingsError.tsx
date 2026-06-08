import { type ValidationResult } from '@/server/configs';

export function SettingsError({validationResult}: {validationResult: ValidationResult}) {
    const validationErrors = validationResult.errors;
    return validationErrors.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-600 text-xs font-bold">!</span>
            </div>
            <div className="flex-1">
                <h3 className="font-semibold text-red-800 text-sm">
                发现 {validationErrors.length} 个配置错误，请修正后保存
                </h3>
                <div className="mt-2 space-y-1">
                {(() => {
                    const summary = validationResult.summary;
                    return (
                    <>
                        {summary.uiErrorCount > 0 && (
                        <p className="text-red-700 text-xs">• 界面设置: {summary.uiErrorCount} 个错误</p>
                        )}
                        {summary.agentErrorCount > 0 && (
                        <p className="text-red-700 text-xs">
                            • Agent 配置: {summary.affectedAgents} 个 Agent 共有 {summary.agentErrorCount} 个错误
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