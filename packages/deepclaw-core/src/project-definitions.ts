import type { UpdateContent } from "@deepclaw/utils";
import type { LLMTaskOutput } from "./flush-agent-types";

export type MissionStatus = 'todo' | 'ongoing' | 'done';

/**
 * The priorities there are, read by the tool schemas, by the list the board opens under the pill,
 * by the two label maps and the colours the pill is drawn with, and by the service that writes one
 * down. One list because a priority a model may write has to be one the board can draw and the
 * service can recognize, and lists of the same four words in five places drift a value apart that
 * nothing would report.
 *
 * Which of the four is offered first is no part of this. A value near the front of an enum is a
 * value a model reaches for a little sooner, and every plan being written would lean toward urgent
 * for nothing more than the order a list was typed in: the schemas read it as it stands, and the
 * board, which wants the loudest word at the top of a list a person reads, turns it over itself.
 */
export const MISSION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type MissionPriority = typeof MISSION_PRIORITIES[number];

export const PROJECT_CONFIG = {
    maxTagCount: 5,
    maxTagTextLength: 15,
    maxTasksCount: 20,
    maxTaskStepsCount: 8,
    /** Read by the tool schemas and by the boxes the user rewrites one in, so both cut at once. */
    maxTaskTitleLength: 50,
    maxTaskDescriptionLength: 100,
    maxProjectDescriptionLength: 80,
} as const;

/**
 * What turned an ask to work in a folder away. Only an answer the person who asked can do something
 * about is worth a word of its own -- `missing` is a folder to make, and they are the ones to say
 * whether it should be -- and everything else about such an ask throws.
 */
export type WorkingDirRefusal = {
    reason: 'missing';
    /**
     * The folder as it was worked out here, which is the one that would be made.
     *
     * Carried because the question is put to whoever asked, and a question has to name what it is
     * about: a path is read against the data root and a leading `~` is their home folder, so the
     * words they typed are not the folder they would get. Asked about those words they would be
     * agreeing to a path nobody had shown them.
     */
    dir: string;
};

export type Project = {
    id: string;
    title: string;
    description: string;
    createdAt: string;
    /**
     * When the user set the work going. A project is planned first and worked after, and this is
     * the word between the two: until it is here, the plan is still being talked over and no task
     * of it goes out to anybody.
     *
     * Written by the user pressing start, and by the first task to leave todo, which is the same
     * thing said in deeds: a card taken up on the board, a task handed to a subagent, a run taking
     * one on itself at the user's asking. Nothing else reaches it, a plan being written and rewritten
     * without any of it beginning. A record from before it existed is dated on the way in, where the
     * loader can see the work already in it.
     */
    startedAt?: string;
    closedAt?: string;
    /**
     * When the user put the project away, which is a different thing from when it closed. Closing is
     * what the work did -- the last task went done and the project said so of itself -- and a closed
     * project is still on the board, still in the list an agent reads, still something to pick up.
     * This is the user saying they are done with it.
     *
     * Never read this to ask whether a project was put away. Where the folder lies is what answers
     * that, and a project that can be reached at all is one lying among the live ones: the manager
     * drops this field off anything it loads, so every project handed out from there has none. What
     * it is for is the two moments the answer is being given -- the record that lands in the archive
     * folder carries the date, and the update sent to the browsers carries it as the word to take the
     * row off the board -- and outside of those two it is absent by design.
     */
    archivedAt?: string;
    creator: string;
    priority: MissionPriority;
    tags?: string[];
    /**
     * The folder the work of this project happens in, absent for the projects that want none.
     *
     * Absent is the ordinary case and means the data root, which is where everything a run reads or
     * writes lies by default. A project given one instead works there: commands start in it, a
     * relative path names a file in it, and reaching for a path under it is not the run reaching
     * outside the workspace. Which is what a project of code wants -- the repository is where the
     * work is, and a checkout copied under `.projects` to be worked on is a checkout nobody can
     * build from.
     *
     * Settled while the project is still being planned and closed to rewriting after that: the work
     * of a project writes into the folder it was working in, and a project moved halfway leaves
     * half of what it did behind with nothing saying where.
     *
     * What is here is a path and no promise about it. A folder can be deleted or renamed at any
     * moment after it was written down, so every run reads it through the manager, which answers
     * with it only while it is still a folder that is there.
     */
    workingDir?: string;
    /**
     * What the whole of the work came to, as opposed to what each task of it produced. The tasks
     * are handed out one by one and read back the same way, so nothing of a project says how it
     * went until someone writes it here.
     */
    output?: LLMTaskOutput;
    /** The tasks under the id each of them is referred to by, which is the id it carries. */
    tasks: Record<string, Task>;
    /** Ids, as everything that points at a task holds one. */
    completedTasks: string[];
    ongoingTasks: string[];
    canStartTasks: string[];
};

/**
 * A project as a browser holds it, which is the whole of it but for the tasks, and the count of
 * those where they were.
 *
 * The tasks are the bulk of a project and a row on the board shows none of them until it is
 * opened, so the list a page starts with leaves them behind -- a hundred projects arrive as a
 * hundred headers rather than a hundred task tables, which is the one thing on that page that
 * grows with how many projects there are. Everything a header does show is here: the counts it
 * reads off `completedTasks` and `ongoingTasks`, which are lists of ids and not of tasks, and how
 * many there are in all, which is what nothing else could say once the tasks are gone.
 *
 * Slim is what such a project is handed out as rather than what it stays. The tasks come after,
 * from the row that opened asking for them and from every later word about the project, which
 * carry the whole of it -- one filled that way is this type still, so absent means not asked for
 * yet rather than none, and `taskCount` is what answers whether there are any.
 */
export type SlimProject = Omit<Project, 'tasks'> & {
    taskCount: number;
    tasks?: Record<string, Task>;
};

/** The whole project, tasks and all. The count travels with them, never apart. */
export function slimProject(project: Project): SlimProject {
    return {...project, taskCount: Object.keys(project.tasks).length};
}

/**
 * The whole project on its way to a browser, which folds what it is handed into the project it
 * holds already.
 *
 * A field left out of that fold is a field nothing was said about rather than a field that is
 * gone, so the fields a write can take off a project are named as null. The working dir is the one
 * of them: sent whole and silent about it, a project whose folder was just taken off is a project
 * whose folder every board goes on showing until the page is loaded again.
 */
export function projectForBrowser(project: Project): UpdateContent<SlimProject> {
    return {...slimProject(project), workingDir: project.workingDir ?? null};
}

/**
 * How many put-away projects go out in one answer, which is the server's own business.
 *
 * Nothing outside has to agree on it: an answer says how many the whole ask found, and what is left
 * to read is that count against the rows in hand. A page cut to this is never a page anybody has to
 * interpret -- a full one says nothing about there being more, and the browser is not left sending
 * one more ask to be told that there is nothing.
 */
export const ARCHIVED_PAGE_SIZE = 20;

/** What a look through the archive asks for. */
export type ArchivedProjectsAsk = {
    /** Words to find in a title, a description or a tag. Empty asks for all of them. */
    query: string;
    /** Whose projects, by agent id, or `all` for everybody's. */
    owner: string;
    /** How many of the answer to step over, the ones before being in hand already. */
    offset: number;
};

/** What comes back from a look through the archive. */
export type ArchivedProjectsPage = {
    /** The projects asked for, the ones put away most recently first, without their tasks. */
    projects: SlimProject[];
    /**
     * Everyone with a project among the ones the words found, and how many each has. Counted by the
     * words alone and not by whose projects are being read: a list narrowed to one agent that named
     * only that agent would be a list with no way back out of them.
     */
    owners: {id: string, count: number}[];
    /**
     * How many the whole ask found -- words and owner both -- which is how the browser knows whether
     * anything is left below what it holds.
     */
    total: number;
};

/**
 * Whether a project is one of those the given words were looking for. Nothing to find finds
 * everything, a search box nobody has typed in narrowing nothing.
 *
 * Out here because the board and the archive search the same projects by the same words, from
 * either side of the wire: the live rows are all in the browser and are filtered there, while the
 * put-away ones are on the server and never all in one place, and two spellings of what a word
 * matches would be a project that a search finds until it is put away, or after.
 */
export function projectMatchesWords(
    project: Pick<Project, 'title' | 'description' | 'tags'>, words: string
): boolean {
    const wanted = words.trim().toLowerCase();
    if (!wanted) {
        return true;
    }
    return [project.title, project.description, ...(project.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(wanted);
}

/** What a row of the board is drawn from, which is all of it but the tasks. */
export function slimProjectRow(project: Project): SlimProject {
    const {tasks, ...rest} = project;
    return {...rest, taskCount: Object.keys(tasks).length};
}

export type TaskStepsContext = {
    steps: string[];
    currentStepIndex: number;
}

/**
 * A verdict on the work of a task and the reading behind it, the latest one there was.
 *
 * Who gave it is not written here: it is the reviewer of the task and can be nobody else. A
 * reviewer is settled while the task is still todo and refused after that, and a review only ever
 * lands on a task already under way, so the name on the task is the name that read it.
 */
export type TaskReview = {
    verdict: 'passed' | 'rejected' | 'waived';
    /** What the reviewer wrote. A waived review is the user's word and carries none. */
    output?: LLMTaskOutput;
    at: string;
};

export type Task = {
    /**
     * What a task is referred to by, everywhere and for as long as it lives. The title is what the
     * user reads and is theirs to change; nothing may hang off it, which is what this is for.
     */
    id: string;
    title: string;
    description: string;
    status: MissionStatus;
    priority: MissionPriority;
    /** Ids of the tasks this one waits for, and of the ones waiting on it. */
    blockedBy: string[];
    blocks: string[];
    assignee?: string;
    /**
     * The agent that reads this task over before it closes, where the task is worth the reading.
     * Set on almost none of them: a review is a run of its own and earns its place only where
     * nothing else would catch a mistake.
     */
    reviewer?: string;
    /** The one review there was, a later one written over it. Absent until the reading happened. */
    review?: TaskReview;
    closedAt?: string;
    output?: LLMTaskOutput;
    pause?: boolean;
    verified?: boolean;
    stepsStatus?: TaskStepsContext
};

/**
 * A task being worked at this very moment, whether by a subagent it was handed to or by an agent
 * working it itself. The status of a task says it was taken up, not that anything is running: it
 * is set before the work begins and stays until the result was accepted.
 */
export type RunningTask = {
    /** The handle of this one run, the only thing telling two runs of a task apart. */
    runId: string;
    projectId: string;
    taskId: string;
    /** Whoever the run stands for: the assignee of the task, or the agent that is on it itself. */
    agentId: string;
    /**
     * Whether this run is the work or the reading of it. Both can be on one task at once -- a task
     * loop that called for its review is waiting on it with the work still in its hands -- so the
     * board draws them on lines of their own, and this is what it tells them apart by. Written where
     * the run is filed and nowhere else: what kind of run it is is which book it went into.
     */
    kind: 'work' | 'review';
    startedAt: string;
};

/**
 * Whether the work of this project has begun, which is the date and nothing else.
 *
 * Deliberately not read off the tasks. The two answers agree in the ordinary case, a task leaving
 * todo being what writes the date, but only the date can be given before anything has moved, which
 * is the whole of what the start button does, and only the date says when. A record from before it
 * existed is dated as it is loaded instead, once.
 */
export function isProjectStarted(project: Omit<Project, 'tasks'>): boolean {
    return !!project.startedAt;
}

/**
 * Asked of the project itself and never of its tasks, so either shape of one can answer.
 *
 * A project is under way from the word that set it going rather than from the first task to move:
 * those are a second apart, and only the first of them is a thing that happened. Read off the
 * tasks, a project the user had just started would sit on the board saying nothing had begun while
 * the button that says so was already gone from its row.
 */
export function getProjectStatus(project: Omit<Project, 'tasks'>): MissionStatus {
    if (project.closedAt) {
        return 'done';
    }
    return isProjectStarted(project) ? 'ongoing' : 'todo';
}

/**
 * How far along a project is, from the two numbers rather than from the tasks: the done ones are
 * `completedTasks`, which is kept as a list of ids beside them, and how many there are in all is
 * the one thing a browser holding no tasks still has to be told. Counting the tasks instead would
 * be asking for them, which is most of a project, to arrive at a percentage.
 */
export function getProjectProgress(
    project?: {completedTasks: string[]; taskCount: number} | null
): number | null {
    if (!project) {
        return null;
    }
    return project.taskCount > 0
        ? Math.round(project.completedTasks.length / project.taskCount * 100) : 0;
}

export function getTaskProgress(task: Task): number | null {
    if (task.status !== 'ongoing' || !task.stepsStatus?.steps.length) {
        return null;
    }
    if (task.stepsStatus.currentStepIndex < 0) {
        return 0;
    }
    return Math.round(((task.stepsStatus.currentStepIndex) / task.stepsStatus.steps.length) * 100);
}
