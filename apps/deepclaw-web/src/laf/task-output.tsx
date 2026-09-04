'use client';

import { type ReactNode, useCallback, useState } from 'react';
import { LLMTaskOutput } from "@deepclaw/core";
import Link from "next/link";
import { Download, Loader2, Pencil } from 'lucide-react';
import { ContentModal } from "@/laf/content-modal";
import { useTranslation } from 'react-i18next';
import { useToastStore } from '@/lib/toast-store';
import { fetchFile, getFileNameFromPath, saveToFile } from '@/lib/browser-file-utils';

/**
 * A report and the way to it, of a task or of anything else that produces one: what it is a report
 * of only shows in the heading it opens under, and in the name it is saved by.
 *
 * `onSave` is whoever owns the report saying it can be rewritten, and takes the whole of the words
 * back: a report is one piece of writing, so what is handed over is all of it and not a change to
 * it. Without it the report is only read, which is every report nobody's hand belongs on -- one
 * handed over as a file, or a reading a reviewer wrote.
 *
 * What it answers is the sentence to show if the report was turned away, and nothing if it went in.
 * Said by the owner rather than here: whoever asked is the only one that knows what could turn it
 * away, and a reason the user can act on is worth more than the general word for a write that
 * failed, which is what a thrown one gets.
 */
export function TaskOutput(
    {output, title, modalTitle, icon, label, onSave}: {
        output: LLMTaskOutput, title: string, modalTitle?: string, icon?: ReactNode, label?: string,
        onSave?: (content: string) => Promise<string | void>
    }
) {
    const [modalContent, setModalContent] = useState<string>('');
    // The words as the user is writing them, and nothing while they are only reading.
    const [draft, setDraft] = useState<string | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const {t} = useTranslation();
    const showToast = useToastStore(s => s.show);

    const openPreview = useCallback(async () => {
        let content = output.content;
        if (output.path) {
            try {
                content = await fetchFile(output.path);
            } catch {
                content += `\n${t('web.pages.output.fetchFailed')}`;
            }
        }
        setModalContent(content ?? '');
    }, [output, t]);

    // The only way to a report is this one word, and a span is no button: what a button would do
    // of itself on Enter and Space is done by hand here.
    const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openPreview();
    }, [openPreview]);

    /**
     * The way out of the panel is a step back out of the writing first, so the report is still in
     * front of the user when a stray Escape lands rather than the page they had left behind. What
     * the box held is gone with it either way: leaving the writing is leaving the writing, whether
     * it was said with the button below or with the corner above. The dark behind the panel says
     * nothing at all while the box is open, that being the click nobody aims.
     */
    const close = useCallback(() => {
        if (draft !== undefined) {
            setDraft(undefined);
            return;
        }
        setModalContent('');
    }, [draft]);

    // The report stays on the screen as the words that were written, the disk having them now: what
    // the record says is on its way back through the stream, and reading it back would be a wait.
    //
    // Turned away or gone wrong, the box stays open with the writing in it: either of those is
    // something to try again, and the words are the user's own.
    const save = useCallback(async () => {
        if (draft === undefined || !onSave) return;
        const content = draft.trim();
        setSaving(true);
        try {
            const refusal = await onSave(content);
            if (refusal) {
                showToast({type: 'warning', message: refusal});
                return;
            }
            setModalContent(content);
            setDraft(undefined);
        } catch {
            showToast({type: 'error', message: t('web.pages.output.saveFailed')});
        } finally {
            setSaving(false);
        }
    }, [draft, onSave, showToast, t]);

    const buttonClassName = `flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg
        transition-colors`;

    return (<>
        {/* A report handed over as a file is downloaded and not read here, whatever it is called
            among other things to do: the word for it is the one thing about it that is certain. */}
        {output.type === 'binary' ? <Link href={output.path!} download
          className="inline-flex items-center gap-1.5 text-[12px] text-sky-600">
            {icon}
            {t('web.pages.output.download')}
        </Link> : <span
          onClick={openPreview}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          className="inline-flex items-center gap-1.5 text-[12px] text-sky-600
            hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
            {icon}
            {label ?? t('web.pages.output.view')}
        </span>}

        {modalContent && <ContentModal
            type={output.type as 'text' | 'markdown'}
            title={modalTitle ?? t('web.pages.output.title')}
            content={modalContent}
            draft={draft === undefined ? undefined : {value: draft, onChange: setDraft}}
            actions={onSave && draft === undefined && <button
                onClick={() => setDraft(modalContent)}
                title={t('web.common.edit')}
                className="hover:text-gray-600 transition-colors"
            >
                <Pencil size={16} />
            </button>}
            footer={draft === undefined ? <button
                onClick={() => saveToFile(
                    modalContent, output.path ? getFileNameFromPath(output.path)
                        : `report_${title}.${output.ext || (output.type === 'text' ? 'txt' : 'md')}`
                )}
                className={`${buttonClassName} text-white bg-blue-600 hover:bg-blue-700`}>
                <Download size={16} />
                {t('web.pages.output.download')}
            </button> : <>
                <button
                    onClick={close}
                    className={`${buttonClassName} text-gray-700 bg-gray-100 hover:bg-gray-200`}>
                    {t('web.common.cancel')}
                </button>
                {/* A report rewritten to nothing is what the service turns away, so the button for
                    it is not there to be pressed. */}
                <button
                    onClick={save}
                    disabled={saving || !draft.trim()}
                    className={`${buttonClassName} text-white bg-blue-600 hover:bg-blue-700
                        disabled:bg-gray-300`}>
                    {saving && <Loader2 size={16} className="animate-spin" />}
                    {t('web.common.save')}
                </button>
            </>}
            onClose={close}
        />}
    </>)
}
