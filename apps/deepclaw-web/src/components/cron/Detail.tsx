import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Play, Pause, Trash2 } from 'lucide-react';
import type { CronTask } from '@deepclaw/core';
import { SupportedLanguage } from '@deepclaw/i18n';
import { EditableField, pencilButtonClassName } from './EditableField';
import { readSchedule, scheduleText } from './cron-words';

type DetailProps = {
    task: CronTask;
    onToggleStatus: () => void;
    onDelete: () => void;
    onEditCron: (cron: string) => void;
    onEditPrompt: (prompt: string) => void;
};

export function Detail({ task, onToggleStatus, onDelete, onEditCron, onEditPrompt }: DetailProps) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language as SupportedLanguage;
    const [editingPrompt, setEditingPrompt] = useState(false);

    // What the clock makes of the draft, said as it is typed: the words where there are words, the
    // complaint where the clock would refuse it, and nothing where it takes an expression no
    // describer can put into words. An empty box is not refused either -- clicking away from one
    // closes it and puts the old schedule back -- so there is nothing to complain of yet.
    const cronHint = useCallback((draft: string) => {
        if (!draft.trim()) {
            return null;
        }
        const {schedulable, words} = readSchedule(lang, draft);
        if (!schedulable) {
            return <p className="text-xs text-red-500">{t('web.pages.cron.edit.invalidCron')}</p>;
        }
        return words ? <p className="text-xs text-gray-500">{words}</p> : null;
    }, [lang, t]);

    const canSaveCron = useCallback(
        (draft: string) => readSchedule(lang, draft).schedulable, [lang]
    );

    return (
        <div className="lg:w-2/5 p-6 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50/50">
            <div className="space-y-4">
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">
                        {t('web.pages.cron.schedule')}
                    </div>
                    <div className="text-sm text-gray-800 mb-1">
                        {scheduleText(lang, task.cron)}
                    </div>
                    <EditableField
                        value={task.cron}
                        onSave={onEditCron}
                        ariaLabel={t('web.pages.cron.edit.schedule')}
                        mono
                        inline
                        displayClassName="text-xs text-gray-400 font-mono"
                        renderHint={cronHint}
                        canSave={canSaveCron}
                    />
                </div>
                <div>
                    <div className="flex items-center gap-1.5 mb-1">
                        <div className="text-xs font-medium text-gray-500">
                            {t('web.pages.cron.prompt')}
                        </div>
                        {!editingPrompt && (
                            <button
                                type="button"
                                onClick={event => {
                                    event.stopPropagation();
                                    setEditingPrompt(true);
                                }}
                                aria-label={t('web.pages.cron.edit.prompt')}
                                title={t('web.pages.cron.edit.prompt')}
                                className={pencilButtonClassName()}
                            >
                                <Pencil size={14} />
                            </button>
                        )}
                    </div>
                    <EditableField
                        value={task.prompt}
                        onSave={onEditPrompt}
                        ariaLabel={t('web.pages.cron.edit.prompt')}
                        multiline
                        hidePencil
                        editing={editingPrompt}
                        onEditingChange={setEditingPrompt}
                        displayClassName={`text-sm text-gray-700 bg-white rounded-lg border border-gray-200
                            p-3 leading-relaxed whitespace-pre-wrap`}
                    />
                </div>
                <div className="flex items-center gap-2 pt-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                            text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100
                            transition-colors`}
                    >
                        {!task.paused ? <Pause size={14} /> : <Play size={14} />}
                        {!task.paused ? t('web.pages.cron.actions.pause')
                            : t('web.pages.cron.actions.resume')}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs
                            font-medium text-red-500 border border-red-200 rounded-md
                            hover:bg-red-50 transition-colors`}
                    >
                        <Trash2 size={14} />
                        {t('web.pages.cron.actions.delete')}
                    </button>
                </div>
            </div>
        </div>
    );
}
