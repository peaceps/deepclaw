'use client'

import { Markdown } from "./markdown";
import { Modal } from "./modal";

type ModalContentType = {
    type: 'text' | 'markdown';
    title: string;
    content: string;
    /**
     * The words in a box the user can change, which is what is shown instead of the reading of them
     * while it is given. Markdown is edited as it was written: what renders is the answer, and the
     * thing being put right is the writing behind it.
     */
    draft?: { value: string; onChange: (value: string) => void };
    actions?: React.ReactNode;
    footer?: React.ReactNode;
    onClose: () => void
}

/** A piece of writing the page stepped aside for, read as it was written or as it renders. */
export function ContentModal(
    { type, title, content, draft, actions, footer, onClose }: ModalContentType
) {
    return (
        <Modal
            title={title}
            actions={actions}
            closeOnBackdrop={!draft}
            footer={footer}
            onClose={onClose}
        >
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {draft ? <textarea
                    value={draft.value}
                    onChange={e => draft.onChange(e.target.value)}
                    aria-label={title}
                    autoFocus
                    className="w-full h-full resize-none text-[13px] text-gray-800 font-mono
                        border border-gray-300 rounded-lg px-3 py-2 focus:outline-none
                        focus:ring-2 focus:ring-blue-500"
                /> : type === 'text' ? <pre className="text-[13px] text-gray-800 whitespace-pre-wrap break-words font-mono cursor-auto">
                    {content}
                </pre> : <Markdown content={content}></Markdown>}
            </div>
        </Modal>
    );
}
