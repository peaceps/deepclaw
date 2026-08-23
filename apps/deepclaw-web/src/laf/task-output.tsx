'use client';

import { type ReactNode, useCallback, useState } from 'react';
import { LLMTaskOutput } from "@deepclaw/core";
import Link from "next/link";
import { Download } from 'lucide-react';
import { ContentModal } from "@/laf/content-modal";
import { useTranslation } from 'react-i18next';
import { fetchFile, getFileNameFromPath, saveToFile } from '@/lib/browser-file-utils';

/**
 * A report and the way to it, of a task or of anything else that produces one: what it is a report
 * of only shows in the heading it opens under, and in the name it is saved by.
 */
export function TaskOutput(
    {output, title, modalTitle, icon}: {
        output: LLMTaskOutput, title: string, modalTitle?: string, icon?: ReactNode
    }
) {
    const [modalContent, setModalContent] = useState<string>('');
    const {t} = useTranslation();

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

    return (<>
        {output.type === 'binary' ? <Link href={output.path!} download
          className="inline-flex items-center gap-1.5 text-[12px] text-sky-600">
            {icon}
            {t('web.pages.output.download')}
        </Link> : <span
          onClick={openPreview}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          className="inline-flex items-center gap-1.5 text-[12px] text-sky-600 cursor-pointer
            hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
            {icon}
            {t('web.pages.output.view')}
        </span>}

        {modalContent && <ContentModal
            type={output.type as 'text' | 'markdown'}
            title={modalTitle ?? t('web.pages.output.title')}
            content={modalContent}
            footer={<button
                onClick={() => saveToFile(
                    modalContent, output.path ? getFileNameFromPath(output.path)
                        : `report_${title}.${output.ext || (output.type === 'text' ? 'txt' : 'md')}`
                )}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white
                    bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer">
                <Download size={16} />
                {t('web.pages.output.download')}
            </button>}
            onClose={() => setModalContent('')}
        />}
    </>)
}
