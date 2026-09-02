'use client'

import { Markdown } from "./markdown";
import { Modal } from "./modal";

type ModalContentType = {
    type: 'text' | 'markdown';
    title: string;
    content: string;
    footer?: React.ReactNode;
    onClose: () => void
}

/** A piece of writing the page stepped aside for, read as it was written or as it renders. */
export function ContentModal(
    { type, title, content, footer, onClose }: ModalContentType
) {
    return (
        <Modal title={title} footer={footer} onClose={onClose}>
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {type === 'text' ? <pre className="text-[13px] text-gray-800 whitespace-pre-wrap break-words font-mono cursor-auto">
                    {content}
                </pre> : <Markdown content={content}></Markdown>}
            </div>
        </Modal>
    );
}
