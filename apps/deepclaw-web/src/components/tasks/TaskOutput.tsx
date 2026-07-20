'use client';

import { useCallback, useState } from 'react';
import { Task } from "@deepclaw/core";
import Link from "next/link";
import { Download } from 'lucide-react';
import { ContentModal } from "@/laf/content-modal";
import { useTranslation } from 'react-i18next';
import { fetchFile, getFileNameFromPath, saveToFile } from '@/lib/browser-file-utils';

export function TaskOutput({ task }: { task: Task }) {
    const output = task.output!;
    const [modalContent, setModalContent] = useState<string>('');
    const {t} = useTranslation();

    const openPreview = useCallback(async () => {
        let content = output.content;
        if (output.path) {
            try {
                content = await fetchFile(output.path);
            } catch {
                content += `\n${t('web.pages.projects.task.output.fetchFailed')}`;
            }
        }
        setModalContent(content ?? '');
    }, [output, t]);

    return (<>
        {output.type === 'binary' ? <Link href={output.path!} download
          className="text-[12px] text-sky-600">
            {t('web.pages.projects.task.output.download')}
        </Link> : <span onClick={openPreview}
          className="text-[12px] text-sky-600 cursor-pointer hover:underline">
            {t('web.pages.projects.task.output.view')}
        </span>}

        {modalContent && <ContentModal
            type={output.type as 'text' | 'markdown'}
            title={t('web.pages.projects.task.output.title')}
            content={modalContent}
            footer={<button
                onClick={() => saveToFile(
                    modalContent, output.path ? getFileNameFromPath(output.path)
                        : `report_${task.title}.${output.ext || (output.type === 'text' ? 'txt' : 'md')}`
                )}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white
                    bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer">
                <Download size={16} />
                {t('web.pages.projects.task.output.download')}
            </button>}
            onClose={() => setModalContent('')}
        />}
    </>)
}
