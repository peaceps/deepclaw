'use client';

import { useCallback, useState } from 'react';
import { FolderTree, Loader2, Pencil, X } from 'lucide-react';
import { isProjectStarted, type SlimProject } from '@deepclaw/core';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/lib/store';
import { useToastStore } from '@/lib/toast-store';
import { ConfirmModal } from '@/laf/confirm-modal';
import { savedWords } from '@/lib/use-editable-field';
import { setProjectWorkingDir } from '@/server/data';

/**
 * Where the work of this project happens, for the user to say and to read back.
 *
 * A project of code is worked in the repository it is about, not in a folder of ours beside our own
 * data, and this is the box that says which one. Empty is the ordinary case and reads as nothing at
 * all: the folder is an answer to a kind of project rather than something every project owes.
 *
 * Written down only while the project is still in todo, so what is drawn after the work starts is
 * the path as plain words. A run writes into the folder it was working in, and a project moved
 * halfway would leave half of what it did behind with nothing left saying where it went.
 *
 * The box does not draw the new path ahead of the server, the way the description strip does: what
 * comes back can be the question of whether to make a folder that is not there, and a path already
 * standing on the board under a question nobody has answered is a path the project has not got.
 */
export function ProjectWorkingDir({project}: {project: SlimProject}) {
    const {t} = useTranslation();
    const updateProject = useAppStore(s => s.updateProject);
    const showToast = useToastStore(s => s.show);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    /** The folder that is not there, kept while the user is asked whether to make it. */
    const [asking, setAsking] = useState<string | null>(null);
    /**
     * The path the user was asked about and said no to, for as long as the box still says it.
     *
     * The box is left open on a no on purpose -- the question asks them to check the path, and the
     * likeliest reason to refuse it is a letter wrong in the one they typed, which they can only
     * fix if it is still there. What that leaves is a box holding a path the server has already
     * refused, and clicking away from it would send that same path back and be asked about all over
     * again: a no would hold only until the next click.
     *
     * So a hand that only clicked elsewhere does not send it. Enter still does, because Enter is
     * aimed: the one who hit cancel by mistake says so with it, and a key that answered with
     * nothing at all would leave them nothing to do but open the box again and type the path a
     * second time.
     *
     * Only for as long as the box still says it: change a letter and it is an answer again. Cleared
     * when the box opens, so a path typed afresh is asked about afresh however it went last time.
     */
    const [declined, setDeclined] = useState<string | null>(null);
    const started = isProjectStarted(project);
    const workingDir = project.workingDir;

    const write = useCallback((next: string, create: boolean = false) => {
        // One ask at a time: the box stays where it is while the server has the path, and a second
        // enter on it would send the same path again -- and, on the way back, ask twice about
        // making the same folder.
        if (saving) {
            return;
        }
        setSaving(true);
        setProjectWorkingDir(project.id, next, create).then(refusal => {
            if (refusal) {
                // The folder the server worked out, not the words that were typed: what is put to
                // the user has to be the folder that would be made, and a relative path or a
                // leading ~ is not that yet. It goes back as the answer to their yes as well, so
                // what is made is the path they were shown.
                setAsking(refusal.dir);
                return;
            }
            setEditing(false);
            updateProject({id: project.id, workingDir: next || null});
        }).catch(() => {
            showToast({type: 'error', message: t('web.pages.projects.project.workingDir.failed')});
        }).finally(() => setSaving(false));
    }, [project.id, saving, showToast, t, updateProject]);

    /**
     * What the box says, taken as the answer.
     *
     * Enter and clicking away are the same word, because that is what leaving a box you have just
     * typed a path into means. Thrown away for want of the key, the path would have to be typed
     * again, and there is nothing in the box worth protecting the user from: the folder is written
     * down and read back on the same strip, and Escape is there for the one who meant to drop it.
     *
     * They part over a path already refused, and `aimed` is which of the two is asking: a key that
     * was pressed at this, or a hand that went somewhere else.
     */
    const commit = useCallback((aimed: boolean) => {
        // An emptied box is a box left alone, the same as every other field opened under a pencil
        // here: the way to be rid of the folder is the cross beside it, which says so and is not a
        // slip of the hand.
        const next = savedWords(draft, workingDir ?? '');
        if (!next || (!aimed && next === declined)) {
            setEditing(false);
            return;
        }
        write(next);
    }, [declined, draft, workingDir, write]);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit(true);
        } else if (e.key === 'Escape') {
            setEditing(false);
        }
    }, [commit]);

    /**
     * The one leaving that is not an answer: the question about making the folder takes the focus
     * off this box as it opens, and the path it is asking about is the one this box has just sent.
     * Committed again there, it would go a second time and be asked about twice.
     */
    const onBlur = useCallback(() => {
        if (asking === null) {
            commit(false);
        }
    }, [asking, commit]);

    if (started && !workingDir) {
        return null;
    }
    return (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-gray-500">
            <FolderTree size={13} className="flex-shrink-0 text-gray-400" />
            {editing ? (
                <input
                    autoFocus
                    aria-label={t('web.pages.projects.project.workingDir.label')}
                    value={draft}
                    placeholder={t('web.pages.projects.project.workingDir.placeholder')}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={onBlur}
                    className="flex-1 min-w-0 px-2 py-0.5 rounded-md border border-gray-300 bg-white
                      font-mono text-xs text-gray-600 outline-none
                      focus:ring-1 focus:ring-cyan-400 focus:border-cyan-400"
                />
            ) : started ? (
                <span
                    className="truncate font-mono text-gray-400"
                    title={t('web.pages.projects.project.workingDir.settled')}
                >{workingDir}</span>
            ) : (
                <button
                    type="button"
                    onClick={() => { setDraft(workingDir ?? ''); setDeclined(null); setEditing(true); }}
                    title={t('web.pages.projects.project.workingDir.edit')}
                    className="group flex min-w-0 items-center gap-1.5 text-left"
                >
                    <span className={`truncate font-mono ${workingDir ? '' : 'text-gray-400'}`}>
                        {workingDir || t('web.pages.projects.project.workingDir.unset')}
                    </span>
                    <Pencil size={11} className="flex-shrink-0 text-gray-300
                      group-hover:text-gray-600 transition-colors" />
                </button>
            )}
            {saving && <Loader2 size={12} className="flex-shrink-0 animate-spin text-gray-400" />}
            {/* The one way the folder comes off, and gone once the work is on, along with every
                other way of writing it. */}
            {!!workingDir && !started && !editing && !saving && <button
                type="button"
                onClick={() => write('')}
                title={t('web.pages.projects.project.workingDir.clear')}
                className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
            >
                <X size={12} />
            </button>}
            {asking !== null && <ConfirmModal
                title={t('web.pages.projects.project.workingDir.make.action')}
                message={t('web.pages.projects.project.workingDir.make.confirm', {path: asking})}
                confirmLabel={t('web.pages.projects.project.workingDir.make.action')}
                tone="go"
                onConfirm={() => { write(asking, true); setAsking(null); }}
                onCancel={() => { setDeclined(draft.trim()); setAsking(null); }}
            />}
        </div>
    );
}
