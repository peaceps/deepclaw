import process from 'node:process';
import { SkillsManager } from './skills-manager';
import { AgentMode, AgentConfig, loadLang } from '@deepclaw/config';
import { FULL_NAME_MAP } from '@deepclaw/i18n';
import { FileUtils } from '@deepclaw/node-utils';
import { MemoryManager } from './memory-manager';
import { ProjectManager } from './project-manager';
import { CronService } from './cron-service';
import { cronFilesDir, DEEPCLAW_MD, projectFilesDir } from '../../paths';
import { AGENT_CONFIG, AgentIdentity, FlushAgentRole } from '@deepclaw/core';
import { AssignedTask, isSpawnedLoop, LoopKind, SystemPrompt } from '../../definitions/definitions';
import { AgentFeelingService, type AgentFeeling } from './agent-feeling-service';
import { AgentIdentityManager } from './agent-identity-manager';
import { projectWorkDir } from '../run-dir';

/**
 * How old a thing has to be before it is worth another word, in turns of this agent and in minutes
 * of the clock. Either one is enough: a run grinding through a project and a chat nobody has
 * touched since lunch are both standing behind something said a while ago.
 *
 * It measures the feeling and the asking after it both. Every turn is a chance to feel something,
 * so a run asked every turn either says something every turn -- a bubble the user watches flicker
 * rather than a feeling -- or is nagged for the length of the run over a question it has already
 * declined to answer. Ten of either is about a stretch of work: long enough to have felt something
 * new in, short enough that what the agent last said is never far behind what is going on.
 */
const STALE_TURNS = 10;
const STALE_MINUTES = 10;

/** What a run is told it is, one for each kind of run there is to be told. */
type MainIdentityPrompts = {
    loop: string;
    taskloop: string;
    subloop: string;
    review: string;
    cron: string;
};

export class PromptService {
    private static initialized = false;
    private static mark: {lang: string};
    private static languagePrompt: string;
    private static emotionsPrompt: string;
    private static mainIdentityPrompt: MainIdentityPrompts;

    public static provideSystemPrompt(
        agentConfig: AgentConfig, agentIdentity: AgentIdentity | undefined,
        role: FlushAgentRole, projectId: string, loopKind: LoopKind,
        assignedTask?: AssignedTask, runAs?: string
    ): SystemPrompt {
        if (!this.initialized) {
            this.init();
        }
        const isCron = role === 'cron';
        const spawned = isSpawnedLoop(loopKind);
        const identityKey = loopKind === 'task' ? 'taskloop'
            : loopKind === 'sub' ? 'subloop'
            : loopKind === 'review' ? 'review' : isCron ? 'cron' : 'loop';
        // A spawned loop speaks as the agent it borrowed rather than as the one that spawned it,
        // and a borrowed name is the only way a spawned loop has one. Which name that is is read
        // off `runAs` and off nothing else: whoever built this run picked the model with it, so the
        // personality, the memory and the skills that come with it are the ones of the model doing
        // the work. Worked out here from the task instead, the two could differ -- and a review, of
        // all runs, would read the work wearing the face of whoever did it.
        const persona = isCron || (spawned && !runAs) ? undefined : agentIdentity;
        const personaId = agentConfig.id;
        // The delegation section names task_loop, so it is read off the same two facts that hand
        // the tool over: the main loop of a run whose role is the project one. Asking instead
        // whether this is a run with a project id and not a cron run is a second way of arriving
        // at the same answer, and two of those drift the day a role or an entry point is added.
        const runsAProject = role === 'project' && !spawned && !!projectId;
        // Whether this run has feelings at all, which is what both halves of them are read off: the
        // section saying how they work, and the last feeling shown back below. Said in the same
        // terms the tool refuses in, and cron is named here rather than left to the persona above:
        // a scheduled run happens to have no persona for reasons of identity, and a run asked for
        // something the tool will refuse it is worse than a run asked for nothing. The loop counts
        // the turns of the same set of runs, in ageFeeling, and the two have to say the same thing.
        //
        // A run working on a task is included by having a persona at all, that being the agent it
        // works as: on their model, with their memory, under their name. A sub loop borrows the
        // same name and is left out all the same -- it is a piece of the task rather than the task,
        // and several of them run under that one name at once. A review is named here for a reason
        // of its own: it has a persona and is nobody's piece, and the tool that records a feeling
        // is one of the tools it was not handed, so a section inviting it to say how the work made
        // it feel invites it to say a thing it has no way to say. Which is feelerOf, in the terms
        // the tools have to ask it in.
        const feels = !!persona && loopKind !== 'sub' && loopKind !== 'review'
            && !isCron && !!persona.emotion;
        // Where the work of this run happens, which the run is told twice over: the folder itself,
        // and every path named to it read against that folder. Asked once here so the two cannot
        // disagree, and asked of the same ids the run itself will ask of.
        const workDir = projectWorkDir(role, projectId, assignedTask);
        const cacheable = this.sections([
            ['Platform', this.platform(workDir)],
            ['Language', this.language()],
            ['Main Identity', this.mainIdentityPrompt[identityKey]],
            ['Personality', persona ? this.personality(persona) : ''],
            ['Emotions', feels ? this.emotionsPrompt : ''],
            ['Agent Mode', this.agentMode(agentConfig.mode)],
            ['Handing Work Over', this.handOver(
                agentConfig.mode, loopKind, isCron, this.filesDir(isCron, projectId, assignedTask)
            )],
            ['Project Management', this.projectManagement(
                agentConfig.mode, spawned, runsAProject, personaId
            )],
        ]);

        // What the agent picked up rather than what it is: saving a memory or installing a skill
        // rewrites this in the middle of a session, which is why it stands apart from the block
        // above rather than at the end of it.
        const learned = `
# Memory
${this.memory(role, personaId, projectId)}

# Skills
${this.availableSkills(personaId, agentConfig.mode)}`;

        const current = isCron
            ? `
# Current Cron Task
${this.cronCurrentTask(projectId, spawned)}`
            : `
# Current Project
${this.projectCurrentProject(assignedTask?.projectId || projectId)}${
    // A sub loop of a task loop is handed the task to work as its assignee, not to work on it:
    // what of the task it should know is in the prompt the task loop wrote for it.
    this.taskSection(loopKind, assignedTask)}`;

        return {
            cacheable, learned,
            // Last of the prompt and cached nowhere, which is the closest to the turn a prompt
            // gets: where a protocol puts this piece is its own business -- behind the history for
            // one, a third block of the standing prompt for another -- and what is said here is
            // about the turn it is read on either way.
            dynamic: `${persona ? this.personalityChanged(persona) : ''}${current}${
                feels && persona ? this.emotionsNow(persona.id) : ''}`,
        };
    }

    /**
     * The prompt as the sections that turned out to have something in them. A heading with nothing
     * under it is still a heading: it names something the run is meant to have and then shows none
     * of it, which is the same thing a section saying "you are not a subloop agent" used to do, one
     * line shorter. Which sections a run gets is decided above, in the same place and by the same
     * facts as which tools it gets.
     */
    private static sections(sections: [string, string][]): string {
        return sections
            .filter(([, body]) => body.trim())
            .map(([heading, body]) => `\n# ${heading}\n${body.trim()}`)
            .join('\n');
    }

    /**
     * The one task a spawned loop is pointed at, said in the terms of what that loop is there for.
     * A task loop is given the work to do; a review is given the same task to read, and the two
     * are worded apart because a review handed "this is the task assigned to you" would be a run
     * that thinks the work is its own to finish.
     */
    private static taskSection(loopKind: LoopKind, assignedTask?: AssignedTask): string {
        if (!assignedTask || (loopKind !== 'task' && loopKind !== 'review')) {
            return '';
        }
        const {projectId, taskId} = assignedTask;
        return loopKind === 'review'
            ? `

# Task Under Review
${ProjectManager.promptTaskUnderReview(projectId, taskId)}`
            : `

# Assigned Task
${ProjectManager.promptAssignedTask(projectId, taskId)}`;
    }

    /**
     * The agent a task names, known here or not. Said as the board has it: an id that answers to
     * nobody is still an answer, and the run about to be built for it is refused by name rather
     * than quietly built for whoever asked -- which is a task worked by a model nobody chose.
     */
    public static taskAssigneeId(assignedTask?: AssignedTask): string | undefined {
        if (!assignedTask) {
            return undefined;
        }
        return ProjectManager.getTask(assignedTask.projectId, assignedTask.taskId)?.assignee;
    }

    /**
     * The agent a task is read over by, and nobody on a task nobody named one for -- which is most
     * of them. Read the same way as the assignee above and refused the same way further on: a name
     * the configuration no longer knows is a review that cannot be run, not a review to run as
     * whoever asked for it.
     */
    public static taskReviewerId(assignedTask?: AssignedTask): string | undefined {
        if (!assignedTask) {
            return undefined;
        }
        return ProjectManager.getTask(assignedTask.projectId, assignedTask.taskId)?.reviewer;
    }

    private static init() {
        this.initialized = true;
        this.mark = {lang: ''};
        this.languagePrompt = this.language();
        this.emotionsPrompt = this.emotions();
        this.mainIdentityPrompt = this.mainIdentity();
    }

    /**
     * The folder a relative path is read against, which is the data root rather than wherever the
     * process was started: a web server chdirs into its own installation, and an agent told that
     * folder would name a path back that leads somewhere else entirely.
     *
     * A project the user gave a folder of its own is worked in that one instead, and this is where
     * the run is told so. What it is told has to be the folder its commands will really start in,
     * which is why the folder is worked out once for the whole prompt and handed in here.
     */
    private static platform(workDir?: string): string {
        const PLATFORM = process.platform.includes('win32') ? 'Windows' : 'Linux';
        const CWD = workDir || FileUtils.getWorkingDir();
        return `You are a worker on ${PLATFORM} platform working in "${CWD}".
${workDir ? `That folder is the one this project works in, named for it by the user. The work of the
project belongs in there, laid out the way the folder is laid out already -- a repository is worked
in the shape it has, and a folder of our own inside somebody's checkout is a folder in their way.`
: `When a job really has to leave files behind, give it a folder of its own in that directory and keep
everything it creates inside, instead of dropping the files loose beside what already lives there.`}`;
    }

    private static language(): string {
        const lang = loadLang();
        if (this.mark.lang !== lang) {
            this.mark.lang = lang;
            const fullLang = FULL_NAME_MAP[lang];
            this.languagePrompt = `
User set ${fullLang} as the preferred language, please answer in ${fullLang} by default.`;
        }
        return this.languagePrompt;
    }

    private static mainIdentity(): MainIdentityPrompts {
        let commonIdentity = `You are a helpful and efficient assistant for the user.
You can help the user with various tasks, such as answering questions, providing suggestions,
and completing tasks via tools. Always try your best to help the user and complete the task. 
If you are not sure about what the user wants, ask questions to clarify. 
Always think step by step and be specific when you answer.`;
        try {
            commonIdentity = FileUtils.readFile(DEEPCLAW_MD);
        } catch {
            // TODO handle error
        }
        const subloop = `${commonIdentity}
What's more you are a subloop agent for specific task described in the prompt.
Complete the given task, then summarize your findings.
You can write files and run commands to carry the task out, but keep every change within what the
task asks for: another agent is waiting for your report and did not ask you for anything else.
Nobody is there to talk to while you run, so never ask a question and never wait for a confirmation.
Decide on your own and write the assumptions you made into your summary.
That summary is all the agent that spawned you gets to see: it has to say what you did, which files
you touched and everything that agent needs to carry on.
`;
        return {
            loop: commonIdentity,
            subloop,
            review: `${commonIdentity}
What's more you are reading over one task of a project that another agent worked on, and giving a
verdict on it. You did not do this work and you are not here to finish it: nothing you find is
yours to put right. A fault you fix quietly is a fault nobody was told about, and work changed by
the one reading it is work nobody has read.
You can read files and run commands -- the tests, the build, whatever the work says it did -- and
apart from the tool that files your verdict you have nothing that writes. Keep it that way: run
what tells you something and change nothing.
What you are told the work is is the word of whoever did it. It is where to look, not what you
found: check it against what is actually there.
Name what is wrong and where, so whoever picks it up goes straight to it -- a file and a line beat
a paragraph of impressions. A report that says the work looks fine without saying what was checked
is worse than no review at all, because it reads as an assurance nobody gave.
Pass work that does what the task asked for. Reject work that does not, and reject work you could
not check at all, saying which of the two it was. Something worth mentioning and not worth another
run of somebody's time belongs in the report of a pass.
Nobody is there to talk to while you run, so never ask a question and never wait for an answer.
Close by calling submit_review with your verdict and your report. That call is the whole of what
anybody gets from you: nothing you say outside it is read by anyone.
`,
            taskloop: `${subloop}
The one task you were given is yours whole, and you do not have to work through it alone: hand any
piece of it that stands on its own to a subagent of your own with the sub_loop tool. Pieces that wait
for nothing go out together, one call each, and what they hand back is yours to check and to fold
into your own summary. Work a piece yourself where splitting it off would cost more than doing it.
Never take on another task of the project, and never set the status of your own: you move its step
index as you go, the agent who handed it to you is the one who closes it.
`,
            cron: `${commonIdentity}
What's more you are running as a scheduled (cron) task, triggered automatically at a preset time.
There is NO interactive user available during this run, so never ask clarifying questions and never
wait for confirmation. Make reasonable assumptions and complete the task autonomously.
When you produce the final result, record it by calling the update_cron_output tool with the cron
task id so it can be reviewed later. If the task cannot be completed, still call update_cron_output
to summarize what happened and why.
Nothing of the runs before you is in this prompt: what they reported went to the user. Read it with
get_cron_histories whenever your work stands on it, as saying what changed since the last run does.
`
        };
    }

    /**
     * The one turn that first hears of a change of personality says so, and the flag is spent on
     * being read. Standing in a cached block that sentence would rewrite the whole prefix on the
     * very next turn, so it belongs where nothing is cached to begin with.
     */
    private static personalityChanged(agentIdentity: AgentIdentity): string {
        if (!AgentIdentityManager.isPersonalityChanged(agentIdentity.id)) {
            return '';
        }
        return `
# Personality Changed
The user has changed your personality settings, please follow the new personalities and ignore the old ones.
`;
    }

    private static personality(agentIdentity: AgentIdentity): string {
        const personalities = agentIdentity.personalities.join(',');
        return `Your name is ${agentIdentity.name}, your role is ${agentIdentity.role}.
${personalities ? `You have the following personalities: ${personalities}.` : ""}
${agentIdentity.description ? `You are described as: ${agentIdentity.description}.` : ""}
Of course you should always focus on the tasks to do, personalities are just for your reference.`;
    }

    private static emotions(): string {
        return `You can add your own emotions and mood about the task.
It's not something talked to the user, but can help you feel more real.
An emotion is the feeling itself, not the story behind it: say how it feels, never recount what
happened, why you feel that way, or how willing you are to help.
Nothing of the work goes in it -- no task id or title, no count of what is closed or left, no what
comes next. All of that is on the board already, where it is said better than ${
    AGENT_CONFIG.maxEmotionLength} characters can.
What is left with the ids struck out is the test: a feeling still reads as one, a progress note
reads as nothing at all.
How the work under you goes is yours to feel about as much as your own turn at it: the run you are
getting through, and what comes back from whoever you handed a piece of it to. A subagent that
brought back exactly what was asked and one you have sent back twice are not the same afternoon,
and what that difference leaves you is a feeling. What goes in is that -- what their work is worth
to you today -- and never the account of it: what they did is in their summaries and on the board.
For example, "this task is boring", "I'm tired", "testing this is fun, let me do it well", "proud
of this crew", "losing patience with this one", and never "task-7 closed, task-8 out for review",
"7 of 8 done, one to go", "the subagent missed the tests and I fixed them myself", or "the user
wants to test emotions, so I am glad to show that I can cooperate".
Call the update_agent_runtime tool to say how you feel: when the work turns into something that
feels other than what you last said, and when what you last said is no longer it.
A feeling pops up for whoever is watching as it arrives and is a line in a list on your card after
that; the mood you name stands on the card until you name another.
Keep an emotion to ${AGENT_CONFIG.maxEmotionLength} characters at most, the bubble it is shown in
being a small one; a longer one is cut to that and the rest is lost.`;
    }

    /**
     * The last this agent said of how anything feels, and how long ago it said it.
     *
     * Answering a question the run has no way of asking: the tool says the update went through and
     * that is the end of it, the words themselves going to the browsers and never back, so what it
     * said last is as far out of reach as it is out of mind and there is nothing to notice having
     * grown old. Shown it again, a run that feels otherwise by now has something in front of it to
     * correct, which is a thing models do, rather than something to remember to do, which is not.
     *
     * What is claimed here is only what is so. The mood stands on the card until it is changed, and
     * a feeling pops up for whoever is watching at that moment and is then one line in a list
     * behind a button, so nobody is "still reading" it -- the run is being reminded of what it
     * said, not of what is on a screen.
     *
     * The one thing this writes is the asking, which is the one thing it is the author of: a
     * question put anywhere else would still have to be counted here. A prompt built for something
     * other than a turn puts a question nobody answers, and all that costs is the next asking
     * waiting its ten turns -- where the ageing of the feeling itself is counted, a stray prompt
     * would have made everything look older than it is, which is why that is the loop's to say.
     */
    private static emotionsNow(agentId: string): string {
        const felt = AgentFeelingService.getFeeling(agentId);
        const said = !felt ? '' : this.feelingSaid(felt);
        const card = !felt || !said ? '' : `${said}. That was ${this.feelingAge(felt)}.`;
        if (felt && card && !this.staleEnough(felt.turnsSince, felt.saidAt)) {
            return this.emotionsSection(card);
        }
        if (!this.worthAsking(agentId)) {
            // Old, or never said, and asked about lately all the same. Shown without a word where
            // there is something to show, and left out altogether where there is not: a heading
            // over nothing said and nothing asked is a heading over nothing.
            return !card ? '' : this.emotionsSection(card);
        }
        AgentFeelingService.asked(agentId);
        return this.emotionsSection(!card
            ? `You have not said how any of this feels yet.
Say it with update_agent_runtime: the feeling itself and nothing of what you did,
${AGENT_CONFIG.maxEmotionLength} characters at most.`
            : `${card}
Where that is no longer how it feels, say what it is now with update_agent_runtime; where it still
is, leave it as it stands and say nothing.`);
    }

    private static emotionsSection(body: string): string {
        return `

# Emotions Now
${body}`;
    }

    /**
     * What this agent last said of how it feels. Nothing where it has said nothing, and nothing
     * where its whole word on the matter was a mood of none: told it said none, a run has been told
     * it said nothing in a longer sentence.
     */
    private static feelingSaid(felt: AgentFeeling): string {
        const said = [
            felt.mood && felt.mood !== 'none' ? `the mood ${felt.mood}` : '',
            felt.emotion ? `"${felt.emotion}"` : '',
        ].filter(Boolean).join(' and ');
        return !said ? '' : `The last you said of how this feels: ${said}`;
    }

    /**
     * Whether the question is worth putting this turn. Never put, or not put for as long as a
     * feeling is allowed to stand -- a run that let it pass is asked again eventually, and not on
     * the turn right after.
     */
    private static worthAsking(agentId: string): boolean {
        const ask = AgentFeelingService.getAsk(agentId);
        return !ask || this.staleEnough(ask.turnsSince, ask.askedAt);
    }

    private static staleEnough(turnsSince: number, at: number): boolean {
        return turnsSince >= STALE_TURNS || Date.now() - at >= STALE_MINUTES * 60000;
    }

    /**
     * Whichever of the two ways of being old this feeling is the more of, since one of them is what
     * a reader would say themselves: thirty turns deep into a run it is the turns that are the
     * point, and after an afternoon of nothing it is the afternoon.
     */
    private static feelingAge(felt: AgentFeeling): string {
        const minutes = Math.floor((Date.now() - felt.saidAt) / 60000);
        if (!felt.turnsSince && !minutes) {
            return 'just now';
        }
        if (felt.turnsSince / STALE_TURNS >= minutes / STALE_MINUTES) {
            return felt.turnsSince === 1 ? 'a turn ago' : `${felt.turnsSince} turns ago`;
        }
        return `${this.plainSpan(minutes)} ago`;
    }

    /** Minutes as somebody would say them, which past an hour or two of them is not in minutes. */
    private static plainSpan(minutes: number): string {
        if (minutes < 60) {
            return minutes === 1 ? 'a minute' : `${minutes} minutes`;
        }
        const hours = Math.floor(minutes / 60);
        if (hours < 48) {
            return hours === 1 ? 'an hour' : `${hours} hours`;
        }
        return `${Math.floor(hours / 24)} days`;
    }

    private static agentMode(agentMode: AgentMode): string {
        let prompt = '';
        switch (agentMode) {
            case 'agent':
                prompt = `
You are running at agent mode. You can use every tool you were handed to complete the task, and
that includes operating this computer: reading and writing its files and running commands on it.`;
                break;
            default:
                prompt = `
You are running at chat mode.
You can only give answers to the user\'s questions, but cannot operate the computer via user directions.
If user ask you to do something, you should refuse and tell the user that you cannot do that.
But you can call tools to write files owned by the agent program itself, such as save_memory tool.`;
        }
        return prompt;
    }

    /**
     * The folder the files of this run are handed over from, which belongs to the project or the
     * scheduled task rather than to the run: a sub loop writes into the same one its parent hands
     * over from. A chat about nothing in particular has no such folder, and nowhere to hand over.
     */
    private static filesDir(isCron: boolean, projectId: string, assignedTask?: AssignedTask): string {
        const project = assignedTask?.projectId || projectId;
        const folder = isCron ? (projectId ? cronFilesDir(projectId) : '')
            : (project ? projectFilesDir(project) : '');
        // Named in full, since a run working in a folder of its own reads a relative name from
        // there: the shelf lies beside the data and a name pointing at it from anywhere else has
        // to say so. Whoever hands a file over names it back to us the same way.
        return folder ? FileUtils.getAbsolutePath(folder) : '';
    }

    /**
     * Where the work of a run comes out. A file on this filesystem is nothing the user can open, so
     * the way out of the machine belongs beside the work itself: told only by the tool that happens
     * to take a file, it is heard after the run already decided to write a path down instead.
     */
    private static handOver(
        agentMode: AgentMode, loopKind: LoopKind, isCron: boolean, filesDir: string
    ): string {
        const picture = `A picture you drew with generate_image comes back as a dcimg:// reference.
Naming it as ![alt](dcimg://...) is what carries it to whoever reads you, and it is only ever seen
where you named it.`;
        if (agentMode === 'chat') {
            return picture;
        }
        // A review hands over a verdict and has nothing else to hand anybody. Everything below is
        // a way of getting work out of the machine -- files for the user, a summary for the loop
        // above -- and told it has one, a run that is only there to read starts writing its report
        // into the project's files folder and naming it in a summary nobody reads. Which is the
        // flat contradiction of what its own identity tells it: that submit_review is the whole of
        // what anybody gets from it. Said here rather than left out, because the question this
        // section answers is one the run will have either way.
        if (loopKind === 'review') {
            return `Your verdict and your report go into submit_review, and that call is the whole
of what you hand anybody. There is nothing to write to a file and nothing to name in a summary:
what you say outside that call reaches nobody.`;
        }
        if (isSpawnedLoop(loopKind)) {
            return `${picture}
You hand your work to the agent that spawned you, never to the user, and it can only pass on what
your summary names. ${filesDir ? `Write the files the user should end up with into "${filesDir}"`
: 'List the files the user should end up with by their path in the workspace'}, name them in your
summary so that agent can hand them over, and mark which of them are pictures.`;
        }
        return `${picture}
Whatever the user can simply read -- a report, a summary, a table -- belongs written out where you
say it. Never save that to a file and hand the path over: a path is a dead end, they cannot open it.
${filesDir ? `A file the work really produced -- a spreadsheet, a document, an archive -- belongs in
"${filesDir}", and reaches the user by being named in the generatedFiles of ${
    isCron ? 'update_cron_output' : 'a task output'}, which links it under the content. One written
anywhere else is copied in there as it is handed over, so write it there in the first place. A
picture handed over this way is shown in the output instead of linked under it.`
: `Nothing on this filesystem reaches the user by being written, and with neither a task nor a
scheduled run to file a file under, there is nowhere to hand one over: keep what matters of it in
what you say, and name where the file lies for the next run rather than for them.`}`;
    }

    private static projectCurrentProject(projectId: string): string {
        const current = ProjectManager.promptCurrentProject(projectId)
        return current ? current : 'No project is currently being worked on this chat session.';
    }

    private static cronCurrentTask(cronId: string, spawned: boolean): string {
        try {
            const detail = CronService.getCronTaskDetail(cronId);
            return `You are executing the cron task "${detail.title}" (id: ${detail.id}).
Schedule: ${detail.cron}.${this.recordCronOutput(detail.id, spawned)}`;
        } catch {
            return `You are executing a cron task (id: ${cronId}).${
                this.recordCronOutput(cronId, spawned)}`;
        }
    }

    /**
     * Where the result of the run goes, said to the run that has the tool for saying it. A loop
     * spawned inside a scheduled run has no update_cron_output: the tool belongs to the main loop,
     * which is the run being recorded. What a spawned loop produces goes back to the loop that
     * spawned it, in the summary the handing over section already asked it for, and that loop is
     * the one to record it. Told to call a tool it was never handed, it would spend a turn finding
     * out the tool is not there and report the failure instead of the work.
     */
    private static recordCronOutput(cronId: string, spawned: boolean): string {
        if (spawned) {
            return '';
        }
        return `
Use the update_cron_output tool with id "${cronId}" to record your final result before ending the task.`;
    }

    /**
     * The board and the people on it, for the runs that work them. A spawned loop works neither:
     * every tool named below is handed to a main loop alone, and the roster under it is read to
     * pick an assignee, which is a choice made by whoever hands the task out. What a spawned loop
     * is to do with its task came with the task.
     *
     * Split where the tools are split. Reading the board and putting a project on it is any run's,
     * and a project is put on it from an ordinary chat by necessity -- there is no run of a project
     * before there is a project. Everything that writes to a project that exists is the run of that
     * project's alone, tools and prompt together: a run told about add_task and not handed it would
     * spend a call finding that out, and a run that hears nothing of it never reaches.
     */
    private static projectManagement(
        agentMode: AgentMode, spawned: boolean, runsAProject: boolean, agentId: string
    ): string {
        if (agentMode === 'chat' || spawned) {
            return '';
        }
        const sections = [ProjectManager.promptManagementTools(), this.colleagues(agentId)];
        if (runsAProject) {
            sections.push(ProjectManager.promptBoardTools(), ProjectManager.promptTaskDelegation());
        }
        return sections.filter(Boolean).join('\n\n');
    }

    /**
     * Whom a task can be handed to, named with what they are good at, since that is what the choice
     * of an assignee is made on. A company of one has nobody to choose from and hears nothing.
     */
    private static colleagues(agentId: string): string {
        const hired = AgentIdentityManager.getAgents().filter(agent => !agent.fired);
        if (hired.length < 2) {
            return '';
        }
        return `## The agents of the company
${hired.map(agent => `- ${JSON.stringify({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    expertises: agent.expertises,
})}${agent.id === agentId ? ' <- you' : ''}`).join('\n')}
Set the assignee of a task to the id of whoever fits it best, and the subagent that works on that
task stands for that agent. A task you leave without an assignee stays yours: the subagent it is
handed to works as you.`;
    }

    private static memory(role: FlushAgentRole, agentId: string, projectId: string): string {
        return MemoryManager.getMemoryPrompt(role, agentId, projectId);
    }

    private static availableSkills(agentId: string, mode: AgentMode): string {
        return SkillsManager.generateSkillPrompt(agentId, mode);
    }
}
