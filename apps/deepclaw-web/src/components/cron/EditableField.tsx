'use client';

import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type EditableFieldProps = {
    value: string;
    onSave: (value: string) => void;
    ariaLabel: string;
    multiline?: boolean;
    mono?: boolean;
    displayClassName?: string;
    renderHint?: (draft: string) => ReactNode;
    canSave?: (value: string) => boolean;
    /** The pencil sits right after the text, not at the far end of a wide row. */
    inline?: boolean;
    /** No pencil on the field itself; something outside opens the editor. */
    hidePencil?: boolean;
    editing?: boolean;
    onEditingChange?: (editing: boolean) => void;
};

export function pencilButtonClassName(): string {
    return 'shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600';
}

/**
 * A line or block of text with a pencil beside it. Clicking the pencil opens an editor; blur or
 * Enter commits, Escape cancels. Whatever calls it decides whether a draft is worth saving.
 */
export function EditableField({
    value, onSave, ariaLabel, multiline, mono, displayClassName, renderHint, canSave, inline,
    hidePencil, editing: editingProp, onEditingChange,
}: EditableFieldProps) {
    const [editingInternal, setEditingInternal] = useState(false);
    const editing = editingProp ?? editingInternal;
    const wasEditing = useRef(false);
    const displayRef = useRef<HTMLDivElement>(null);
    const measuredHeight = useRef<number | undefined>(undefined);
    const [draft, setDraft] = useState(value);
    const [editHeight, setEditHeight] = useState<number>();

    useLayoutEffect(() => {
        if (!editing && multiline && displayRef.current) {
            measuredHeight.current = displayRef.current.offsetHeight;
        }
    });

    useEffect(() => {
        if (editing && multiline) {
            setEditHeight(measuredHeight.current);
        }
    }, [editing, multiline]);

    const setEditing = useCallback((next: boolean) => {
        onEditingChange?.(next);
        if (editingProp === undefined) {
            setEditingInternal(next);
        }
    }, [editingProp, onEditingChange]);

    useEffect(() => {
        if (editing && !wasEditing.current) {
            setDraft(value);
        }
        wasEditing.current = editing;
    }, [editing, value]);

    const start = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        setDraft(value);
        setEditing(true);
    }, [setEditing, value]);

    const cancel = useCallback(() => {
        setDraft(value);
        setEditing(false);
    }, [setEditing, value]);

    /**
     * A draft the caller will not have stays in the box, complaint and all.
     *
     * Which means a click elsewhere does not close this editor, and that is the point: a schedule
     * typed wrong is work, and closing on the blur threw it away silently -- the words went, the red
     * line under them went with the words, and nothing said that anything had happened. Escape is
     * still the way out, and it is the one that says so.
     *
     * An emptied box is not that case. Nothing was written to lose, and what was there is still on
     * the task, so it closes and the old value comes back.
     */
    const commit = useCallback(() => {
        if (!editing) return;
        const trimmed = draft.trim();
        if (trimmed && canSave && !canSave(trimmed)) {
            return;
        }
        setEditing(false);
        if (!trimmed || trimmed === value) {
            return;
        }
        onSave(trimmed);
    }, [canSave, draft, editing, onSave, setEditing, value]);

    const onKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
            return;
        }
        if (event.key === 'Enter' && !multiline) {
            event.preventDefault();
            commit();
            return;
        }
        if (event.key === 'Enter' && multiline && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
        }
    }, [cancel, commit, multiline]);

    const fieldClass = `w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-800
        outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100
        ${mono ? 'font-mono' : ''}`;

    if (editing) {
        return (
            <div className="space-y-1" onClick={event => event.stopPropagation()}>
                {multiline ? (
                    <textarea
                        autoFocus
                        aria-label={ariaLabel}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={commit}
                        style={editHeight ? {height: editHeight} : undefined}
                        className={`${fieldClass} ${displayClassName ?? ''} resize-y overflow-y-auto
                            box-border`}
                    />
                ) : (
                    <input
                        autoFocus
                        type="text"
                        aria-label={ariaLabel}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={onKeyDown}
                        onBlur={commit}
                        className={`${fieldClass} px-2 py-1`}
                    />
                )}
                {renderHint?.(draft)}
            </div>
        );
    }

    if (hidePencil) {
        return <div ref={displayRef} className={displayClassName ?? ''}>{value}</div>;
    }

    return (
        <div className={inline
            ? 'inline-flex items-center gap-1.5 max-w-full min-w-0'
            : 'flex items-start gap-1.5 min-w-0'}>
            <div className={inline
                ? `min-w-0 truncate ${displayClassName ?? ''}`
                : `flex-1 min-w-0 ${displayClassName ?? ''}`}>{value}</div>
            <button
                type="button"
                onClick={start}
                aria-label={ariaLabel}
                title={ariaLabel}
                className={pencilButtonClassName()}
            >
                <Pencil size={14} />
            </button>
        </div>
    );
}
