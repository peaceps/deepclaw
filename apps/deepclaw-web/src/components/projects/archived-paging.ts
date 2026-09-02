import type { ArchivedProjectsPage, SlimProject } from '@deepclaw/core';

/**
 * The rows in hand with the page that just landed added to them, and nothing twice.
 *
 * The archive is asked for by how many rows are held, so a project put away while the window is
 * open shifts every page after it along by one and the row at the seam comes back a second time.
 * It is the same project both times, and a list holding it twice is a list with two rows under one
 * key: the one already in hand stays, being the one already on the screen.
 *
 * Which leaves the page one row shorter for each project that landed in between, and a whole page
 * of them would leave it no longer at all -- nothing new to scroll past, so nothing to ask the next
 * page for until the reader scrolls again. Twenty projects put away while somebody has this window
 * open is not a thing worth building against.
 */
export function withNextPage(held: SlimProject[], landed: SlimProject[]): SlimProject[] {
    const ids = new Set(held.map(project => project.id));
    return [...held, ...landed.filter(project => !ids.has(project.id))];
}

/**
 * The page as it stands with one project gone from the archive, put back on the board or thrown
 * away for good.
 *
 * Written here rather than asked for afresh: a page is pages deep by the time somebody is clearing
 * an archive out, and reading it all back would drop them at the top of it after every row they
 * clear. The archive is a row shorter too, so the next page still begins where the rows in hand end.
 *
 * The counts the row was in come down with it: how many there are to read, which is what says
 * whether there is another page to ask for, and how many stand against the name that wrote it,
 * which is what the owner box offers. A name down to none leaves the box, having nothing left to
 * pick out.
 */
export function withoutProject(page: ArchivedProjectsPage, projectId: string): ArchivedProjectsPage {
    const gone = page.projects.find(project => project.id === projectId);
    if (!gone) {
        return page;
    }
    return {
        projects: page.projects.filter(project => project.id !== projectId),
        owners: page.owners
            .map(one => one.id === gone.creator ? {...one, count: one.count - 1} : one)
            .filter(one => one.count > 0),
        total: Math.max(page.total - 1, 0),
    };
}
