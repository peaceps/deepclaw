'use client';

import {
    Archive, CalendarDays, Folder, Loader2, RotateCcw, Search, Trash2, User, X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type ArchivedProjectsPage, type SlimProject } from '@deepclaw/core';
import { Modal } from '@/laf/modal';
import { deleteArchivedProject, getArchivedProjects, restoreProject } from '@/server/data';
import { useAppStore } from '@/lib/store';
import { useToastStore } from '@/lib/toast-store';
import { formatDate } from '@/components/component-utils';
import { getLogger } from '@/lib/logger';
import { ProjectMeta } from './ProjectMeta';
import { withNextPage, withoutProject } from './archived-paging';

const logger = getLogger('ArchivedProjects');

/**
 * How long the typing has to stop before the words are asked about. A page per keystroke is a list
 * that flickers through what nobody asked to see, and a read of the archive for each letter.
 */
const SEARCH_PAUSE = 250;

/** How near the bottom is near enough to ask for what comes after it. */
const SCROLL_THRESHOLD = 80;

/**
 * The way back to the projects the user has put away: a word in the header of the board, and the
 * whole of the looking back in the window it opens.
 *
 * A window rather than a place on the board, and out of the way until it is asked for, because the
 * board is what there is to do and these are what was done. Nothing of it is loaded until it is
 * opened either -- the archive is read off the disk, project by project -- and closing it is the
 * end of that: what was in it is asked for again next time.
 */
export function ArchivedProjects() {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title={t('web.pages.projects.archived.hint')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5
                    text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
                <Archive size={15} />
                {t('web.pages.projects.archived.action')}
            </button>
            {open && <ArchivedProjectsModal onClose={() => setOpen(false)} />}
        </>
    );
}

/**
 * What came back and the ask it came back to, kept as one thing.
 *
 * Kept as one thing because that is what makes a stale answer harmless rather than something to
 * guard against: the words move on while a read is out, and the answer that lands is an answer to a
 * question nobody is asking any more. Stamped with its own ask, it is simply not the answer to what
 * is on the screen, and the comparison that says so is the same one that says a spinner is due.
 */
type Answered = {
    query: string;
    owner: string;
    /** What was read, or nothing at all where the reading failed. */
    page?: ArchivedProjectsPage;
    /** Set where a page after the first would not come, so that scrolling stops asking for it. */
    stranded?: boolean;
};

function ArchivedProjectsModal({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    const [words, setWords] = useState('');
    const [query, setQuery] = useState('');
    const [owner, setOwner] = useState('all');
    const [answered, setAnswered] = useState<Answered>();
    const [reading, setReading] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => setQuery(words), SEARCH_PAUSE);
        return () => clearTimeout(timer);
    }, [words]);

    /**
     * The first page of what is being asked for now. The words and the owner both come through here,
     * so a list narrowed while it was being read starts again at the top of the new answer rather
     * than partway down the last one.
     */
    useEffect(() => {
        let dropped = false;
        getArchivedProjects({ query, owner, offset: 0 }).then(page => {
            if (dropped) return;
            setAnswered({ query, owner, page });
            listRef.current?.scrollTo({ top: 0 });
        }).catch(error => {
            logger.error(error, 'Failed to read the projects that were put away');
            if (!dropped) setAnswered({ query, owner });
        });
        return () => {
            dropped = true;
        };
    }, [query, owner]);

    const current = answered?.query === query && answered.owner === owner ? answered : undefined;
    // The rows as one thing that holds still while nothing lands, an empty list written afresh each
    // render being a new list, and this is what asking for the next page is measured from.
    const held = useMemo(() => current?.page?.projects ?? [], [current]);
    const waiting = !current || reading;
    const more = !!current?.page && !current.stranded && held.length < current.page.total;

    const loadMore = useCallback(async () => {
        if (!more || reading) return;
        setReading(true);
        try {
            const page = await getArchivedProjects({ query, owner, offset: held.length });
            // Onto the answer this was asked of and no other: the words can move on while this is
            // out, and rows read under the old ones belong to a list that is no longer on the screen.
            setAnswered(prev => prev?.query === query && prev.owner === owner
                ? {...prev, page: {...page, projects: withNextPage(held, page.projects)}}
                : prev);
        } catch (error) {
            logger.error(error, 'Failed to read more of the projects that were put away');
            setAnswered(prev => prev?.query === query && prev.owner === owner
                ? {...prev, stranded: true} : prev);
        } finally {
            setReading(false);
        }
    }, [held, more, owner, query, reading]);

    const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const list = event.currentTarget;
        if (list.scrollHeight - list.scrollTop - list.clientHeight < SCROLL_THRESHOLD) {
            loadMore();
        }
    }, [loadMore]);

    /**
     * A project that has left the archive, off the list and out of what the list is counted by.
     *
     * Onto the answer as it was stamped, the row having come from that answer: it is the same list
     * with a row missing, not an answer to anything new, and the ask it was read under is still the
     * ask on the screen.
     */
    const onGone = useCallback((projectId: string) => setAnswered(
        prev => prev?.page ? {...prev, page: withoutProject(prev.page, projectId)} : prev
    ), []);

    return (
        <Modal title={t('web.pages.projects.archived.title')} size="tall" onClose={onClose}>
            {/* Off the last answer that landed and not off the answer to what is being asked now.
                The words do move this list -- an owner whose projects they passed over drops off it
                -- but they move it slower than they move the rows, and a name left standing while a
                read is out, counted by the words before these, is worth more than a box that empties
                itself as somebody types. */}
            <ArchivedToolbar
                words={words} owner={owner} owners={answered?.page?.owners}
                onWords={setWords} onOwner={setOwner}
            />
            <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {held.map(project => (
                    <ArchivedRow key={project.id} project={project} onGone={onGone} />
                ))}
                {waiting && <div className="flex justify-center py-3">
                    <Loader2 size={18} className="animate-spin text-gray-400" />
                </div>}
                {/* Scrolling is how the rest is normally asked for, and this is here for when there
                    is no scrolling to be done: rows leave this list as they are put back or thrown
                    away, and a list worn short of the window it is in cannot reach what follows it
                    by scrolling. */}
                {!waiting && more && <div className="flex justify-center py-3">
                    <button
                        type="button"
                        onClick={loadMore}
                        className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs text-gray-500
                            transition-colors hover:bg-gray-50 hover:text-gray-800"
                    >
                        {t('web.pages.projects.archived.more')}
                    </button>
                </div>}
                {/* The archive that would not be read, and the rest of one that would not: the same
                    thing said where the list is not there at all and where it stops short. Not said
                    of a list emptied by its own rows leaving, which has the word for more under it
                    and is not empty of anything. */}
                {!waiting && ((!held.length && !more) || current?.stranded) &&
                    <p className="py-8 text-center text-sm text-gray-400">
                        {t(!current?.page || current.stranded
                            ? 'web.pages.projects.archived.failed'
                            : query || owner !== 'all' ? 'web.pages.projects.archived.noResults'
                            : 'web.pages.projects.archived.empty')}
                    </p>}
            </div>
        </Modal>
    );
}

function ArchivedToolbar({ words, owner, owners, onWords, onOwner }: {
    words: string;
    owner: string;
    owners?: ArchivedProjectsPage['owners'];
    onWords: (words: string) => void;
    onOwner: (owner: string) => void;
}) {
    const { t } = useTranslation();
    const agents = useAppStore(s => s.agents);

    const options = useMemo(() => {
        const found = owners ?? [];
        // Whoever is being read is on the list even where the words found none of theirs: a box gone
        // blank is no answer to why the list under it is empty.
        return owner === 'all' || found.some(one => one.id === owner)
            ? found : [...found, { id: owner, count: 0 }];
    }, [owners, owner]);

    return (
        <div className="flex flex-col gap-2 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    value={words}
                    onChange={event => onWords(event.target.value)}
                    placeholder={t('web.pages.projects.search.placeholder')}
                    className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-8 text-sm text-gray-900
                        outline-none transition-colors placeholder:text-gray-400
                        focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                {words && <button
                    type="button"
                    onClick={() => onWords('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400
                        transition-colors hover:bg-gray-100 hover:text-gray-600"
                    aria-label={t('web.pages.projects.search.clear')}
                >
                    <X size={14} />
                </button>}
            </div>
            <select
                value={owner}
                name="owner"
                onChange={event => onOwner(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700
                    outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100
                    sm:w-auto sm:max-w-48"
                aria-label={t('web.pages.projects.ownerFilter')}
            >
                <option value="all">
                    {t('web.pages.projects.ownerFilter')}: {t('web.common.all')}
                </option>
                {options.map(one => (
                    <option key={one.id} value={one.id}>
                        {agents.find(agent => agent.id === one.id)?.name ?? one.id} ({one.count})
                    </option>
                ))}
            </select>
        </div>
    );
}

/**
 * One project that was put away. Nothing of what it holds is written from here -- the row opens
 * nothing, the tags are not edited, the tasks are not asked for -- and what can be done to it is
 * done to the whole of it: back onto the board, or off the disk.
 *
 * Both leave the row, so both are the same call to whoever holds the list.
 */
function ArchivedRow({ project, onGone }: {
    project: SlimProject;
    onGone: (projectId: string) => void;
}) {
    const { t, i18n } = useTranslation();
    const showToast = useToastStore(s => s.show);
    const [confirming, setConfirming] = useState(false);
    // The row waits on the answer rather than leaving on the word: a project cleared off the screen
    // that is still on the disk is worse than a moment of nothing happening, and the two words this
    // row can say are ones nobody wants to have said twice.
    const [busy, setBusy] = useState(false);
    const ownerName = useAppStore(
        s => s.agents.find(agent => agent.id === project.creator)?.name
    ) ?? project.creator;

    const act = useCallback(async (what: 'restore' | 'delete') => {
        setConfirming(false);
        setBusy(true);
        try {
            await (what === 'restore'
                ? restoreProject(project.id) : deleteArchivedProject(project.id));
            // The board is told of a restored project by the server, so there is nothing to say
            // about it here beyond that the archive no longer holds it.
            onGone(project.id);
        } catch (error) {
            logger.error(error, `Failed to ${what} the archived project ${project.id}`);
            showToast({type: 'error', message: t(`web.pages.projects.archived.${what}.failed`)});
            setBusy(false);
        }
    }, [onGone, project.id, showToast, t]);

    return (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center
                        rounded-lg bg-gray-100 text-gray-400">
                        <Folder size={16} />
                    </span>
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <h3 className="truncate font-semibold text-gray-800">{project.title}</h3>
                            {project.tags?.map(tag => (
                                <span key={tag} className="hidden flex-shrink-0 rounded-full bg-sky-50 px-2
                                    py-0.5 text-[11px] text-sky-600 sm:inline">{tag}</span>
                            ))}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{project.description}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                                <User size={12} />{ownerName}
                            </span>
                            {/* The date it was put away, and where a folder moved by hand has none,
                                the date it does have said as the date it is. */}
                            <span className="flex items-center gap-1">
                                <CalendarDays size={12} />
                                {project.archivedAt
                                    ? t('web.pages.projects.archived.putAwayOn',
                                        {date: formatDate(i18n.language, project.archivedAt)})
                                    : t('web.pages.projects.archived.writtenOn',
                                        {date: formatDate(i18n.language, project.createdAt)})}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 sm:gap-6">
                    <ProjectMeta project={project} />
                    {/* The question is asked in the row rather than in a dialog over this one. A
                        dialog inside a window is two dialogs answering the same Escape, and the one
                        that closes leaves the page behind both of them scrolling again. What it
                        costs is that Escape with the question up still answers the window, which is
                        the larger of the two things to close and takes the question with it. */}
                    {confirming ? <div className="flex items-center gap-2">
                        <span className="text-xs text-red-500">
                            {t('web.pages.projects.archived.delete.confirm')}
                        </span>
                        <button
                            type="button"
                            onClick={() => act('delete')}
                            className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white
                                transition-colors hover:bg-red-600"
                        >
                            {t('web.pages.projects.archived.delete.action')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-500
                                transition-colors hover:bg-gray-50"
                        >
                            {t('web.common.cancel')}
                        </button>
                    </div> : <div className="flex items-center gap-1">
                        {/* Nothing is asked before putting a project back: it goes where it came
                            from, and putting it away again is the same click it took to get here.
                            Throwing it away is asked about because there is no click back. */}
                        <button
                            type="button"
                            onClick={() => act('restore')}
                            disabled={busy}
                            title={t('web.pages.projects.archived.restore.hint')}
                            aria-label={t('web.pages.projects.archived.restore.action')}
                            className={`rounded-md p-1.5 text-gray-400 transition-colors
                                ${busy ? 'cursor-not-allowed opacity-40'
                                    : 'hover:bg-emerald-50 hover:text-emerald-600'}`}
                        >
                            <RotateCcw size={15} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirming(true)}
                            disabled={busy}
                            title={t('web.pages.projects.archived.delete.hint')}
                            aria-label={t('web.pages.projects.archived.delete.action')}
                            className={`rounded-md p-1.5 text-gray-400 transition-colors
                                ${busy ? 'cursor-not-allowed opacity-40'
                                    : 'hover:bg-red-50 hover:text-red-500'}`}
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>}
                </div>
            </div>
        </div>
    );
}
