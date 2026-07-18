'use client';

import { useState } from 'react';
import { Task } from "@deepclaw/core";
import Link from "next/link";
import { ContentModal } from "@/laf/content-modal";
import { useTranslation } from 'react-i18next';

export function TaskOutput({ output }: { output: NonNullable<Task['output']> }) {
    const [modalOpen, setModalOpen] = useState(false);
    const {t} = useTranslation();

    return (<>
        {output.path ? <Link href={output.path} download className="text-[12px] text-sky-600">
            {t('web.pages.projects.task.output.download')}
        </Link> : <span onClick={() => setModalOpen(true)} className="text-[12px] text-sky-600 cursor-pointer hover:underline">
            {t('web.pages.projects.task.output.view')}
        </span>}
        {modalOpen && <ContentModal
            type={output.type as 'text' | 'markdown'}
            title={t('web.pages.projects.task.output.title')}
            content={output.content ?? ''}
            onClose={() => setModalOpen(false)}
        />}
    </>)
}
