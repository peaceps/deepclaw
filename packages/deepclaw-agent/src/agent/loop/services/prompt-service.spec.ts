import process from 'node:process';
import {describe, expect, test, vi} from 'vitest';
import {type AgentIdentity, type CronTask, type Task} from '@deepclaw/core';
import {type LoopKind} from '../../definitions/definitions';
import {newTestAgentConfig} from '../../../test-support/one-loop-context';
import {type AgentFeeling} from './agent-feeling-service';

const WORKING_DIR = '/home/someone/.deepclaw';

const mocks = vi.hoisted(() => ({
    loadLang: vi.fn<() => string>(),
    readFile: vi.fn<(filePath: string) => string>(),
    readDir: vi.fn<(dirPath: string) => {[key: string]: {dir: string, content: string}}>(),
    exists: vi.fn<(filePath: string) => boolean>(),
    getWorkingDir: vi.fn<() => string>(() => '/home/someone/.deepclaw'),
}));

vi.mock('@deepclaw/config', () => ({loadLang: mocks.loadLang}));
vi.mock('@deepclaw/i18n', () => ({FULL_NAME_MAP: {en: 'English', zh: 'Chinese'}}));
vi.mock('@deepclaw/node-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@deepclaw/node-utils')>()),
    FileUtils: {
        readFile: mocks.readFile, readDir: mocks.readDir, exists: mocks.exists,
        getWorkingDir: mocks.getWorkingDir,
    },
    getLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
    getLoopLogger: () => ({debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()}),
}));

const BUILT_IN_IDENTITY = 'You are a helpful and efficient assistant for the user.';

/**
 * The platform, language and identity blocks are built while the class is initialized, so every
 * test reloads the module after arranging its mocks. The sibling services are replaced by spies
 * on the freshly loaded classes; the empty file system mock keeps their own loading harmless.
 */
async function loadService(setup: () => void = () => undefined) {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.loadLang.mockReturnValue('en');
    mocks.readDir.mockReturnValue({});
    mocks.exists.mockReturnValue(false);
    mocks.readFile.mockImplementation((filePath: string) => {
        throw new Error(`File ${filePath} not found.`);
    });
    setup();
    const {PromptService} = await import('./prompt-service');
    const {MemoryManager} = await import('./memory-manager');
    const {SkillsManager} = await import('./skills-manager');
    const {ProjectManager} = await import('./project-manager');
    const {CronService} = await import('./cron-service');
    const {AgentIdentityManager} = await import('./agent-identity-manager');
    const {AgentFeelingService} = await import('./agent-feeling-service');
    return {
        PromptService,
        getFeeling: vi.spyOn(AgentFeelingService, 'getFeeling').mockReturnValue(undefined),
        getAsk: vi.spyOn(AgentFeelingService, 'getAsk').mockReturnValue(undefined),
        asked: vi.spyOn(AgentFeelingService, 'asked').mockImplementation(() => undefined),
        aTurnPassed: vi.spyOn(AgentFeelingService, 'aTurnPassed').mockImplementation(() => undefined),
        getTask: vi.spyOn(ProjectManager, 'getTask').mockReturnValue(undefined),
        assignedTaskPrompt: vi.spyOn(ProjectManager, 'promptAssignedTask')
            .mockReturnValue('the assigned task'),
        reviewedTaskPrompt: vi.spyOn(ProjectManager, 'promptTaskUnderReview')
            .mockReturnValue('the task under review'),
        getAgent: vi.spyOn(AgentIdentityManager, 'getAgent').mockReturnValue(undefined),
        getAgents: vi.spyOn(AgentIdentityManager, 'getAgents').mockReturnValue([]),
        personalityChanged: vi.spyOn(AgentIdentityManager, 'isPersonalityChanged').mockReturnValue(false),
        memoryPrompt: vi.spyOn(MemoryManager, 'getMemoryPrompt').mockReturnValue('the memory prompt'),
        skillPrompt: vi.spyOn(SkillsManager, 'generateSkillPrompt').mockReturnValue('the skills prompt'),
        currentProject: vi.spyOn(ProjectManager, 'promptCurrentProject')
            .mockReturnValue('the current project'),
        managementTools: vi.spyOn(ProjectManager, 'promptManagementTools')
            .mockReturnValue('the project tools'),
        boardTools: vi.spyOn(ProjectManager, 'promptBoardTools')
            .mockReturnValue('the board tools'),
        taskDelegation: vi.spyOn(ProjectManager, 'promptTaskDelegation')
            .mockReturnValue('hand the tasks over'),
        cronTaskDetail: vi.spyOn(CronService, 'getCronTaskDetail')
            .mockReturnValue({id: 'c1', title: 'nightly report', cron: '0 9 * * *'} as CronTask),
    };
}

/** Pays the transform of the module graph while the file loads, out of reach of a test timeout. */
await loadService();

function newIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
    return {
        id: 'a1',
        avatar: '🐟',
        role: 'engineer',
        personalities: ['calm', 'curious'],
        emotion: true,
        expertises: ['typescript'],
        name: 'Ada',
        fired: false,
        description: 'the agent who ships',
        ...overrides,
    };
}

describe('platform and language', () => {

    test('tells the model which platform and folder it works in', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        const platform = process.platform.includes('win32') ? 'Windows' : 'Linux';
        expect(cacheable).toContain(
            `You are a worker on ${platform} platform working in "${WORKING_DIR}".`
        );
    });

    test('asks for a folder of its own instead of files left loose in that folder', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('give it a folder of its own in that directory');
    });

    test('asks the model to answer in the configured language', async () => {
        const {PromptService} = await loadService(() => mocks.loadLang.mockReturnValue('zh'));
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('User set Chinese as the preferred language, please answer in Chinese');
    });

    test('picks up a language that changed between two prompts', async () => {
        const {PromptService} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        mocks.loadLang.mockReturnValue('zh');
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('please answer in Chinese');
        expect(cacheable).not.toContain('please answer in English');
    });

    test('starts the cacheable prompt with the platform section', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable.startsWith('\n# Platform\n')).toBe(true);
    });

    test('keeps the sections in a stable order', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(cacheable.split('\n').filter(line => line.startsWith('# '))).toEqual([
            '# Platform', '# Language', '# Main Identity', '# Personality', '# Emotions',
            '# Agent Mode', '# Handing Work Over', '# Project Management',
        ]);
    });

    /** A heading over nothing names something the run is meant to have and then shows none of it. */
    test('leaves out the heading of a section this run has nothing under', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'sub'
        );
        expect(cacheable.split('\n').filter(line => line.startsWith('# '))).toEqual([
            '# Platform', '# Language', '# Main Identity', '# Agent Mode', '# Handing Work Over',
        ]);
    });

    /** Behind the block that never moves, so saving a memory leaves that one read from the cache. */
    test('keeps what the agent picked up out of the block that never moves', async () => {
        const {PromptService} = await loadService();
        const {learned} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(learned.split('\n').filter(line => line.startsWith('# '))).toEqual(['# Memory', '# Skills']);
    });
});

describe('main identity', () => {

    test('uses the content of DEEPCLAW.md as the shared identity', async () => {
        const {PromptService} = await loadService(
            () => mocks.readFile.mockReturnValue('you are the house agent')
        );
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(mocks.readFile).toHaveBeenCalledWith('DEEPCLAW.md');
        expect(cacheable).toContain('you are the house agent');
    });

    test('falls back to the built in identity when DEEPCLAW.md cannot be read', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain(BUILT_IN_IDENTITY);
    });

    test('adds the sub loop rules for a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'sub');
        expect(cacheable).toContain('you are a subloop agent for specific task described in the prompt');
        expect(cacheable).toContain('You can write files and run commands to carry the task out');
        expect(cacheable).toContain('never ask a question');
    });

    test('adds the autonomous rules for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'main');
        expect(cacheable).toContain('you are running as a scheduled (cron) task');
        expect(cacheable).toContain('never ask clarifying questions');
    });

    /** A run starts from the prompt of the task alone, so it has to be told where the rest is. */
    test('tells a cron loop how to read what the runs before it reported', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'main');
        expect(cacheable).toContain('Nothing of the runs before you is in this prompt');
        expect(cacheable).toContain('get_cron_histories');
    });

    test('gives a main loop the plain identity only', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).not.toContain('you are a subloop agent');
        expect(cacheable).not.toContain('scheduled (cron) task');
    });

    test('treats a sub loop of a cron task as a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'sub');
        expect(cacheable).toContain('you are a subloop agent');
        expect(cacheable).not.toContain('scheduled (cron) task');
    });
});

describe('personality and emotions', () => {

    test('describes the name, role and personalities of the agent', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(cacheable).toContain('Your name is Ada, your role is engineer.');
        expect(cacheable).toContain('You have the following personalities: calm,curious.');
        expect(cacheable).toContain('You are described as: the agent who ships.');
    });

    test('leaves out the personality list when the agent has none', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({personalities: []}), 'agent', '', 'main'
        );
        expect(cacheable).toContain('Your name is Ada');
        expect(cacheable).not.toContain('You have the following personalities');
    });

    test('leaves out the description when the agent has none', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({description: ''}), 'agent', '', 'main'
        );
        expect(cacheable).not.toContain('You are described as');
    });

    /**
     * The flag is spent on being read, so the sentence is there for one turn and gone the next.
     * In a cached block that alone would rewrite the whole prefix on the turn right after.
     */
    test('says a personality changed where nothing is cached', async () => {
        const {PromptService, personalityChanged} = await loadService();
        personalityChanged.mockReturnValue(true);
        const {cacheable, dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(dynamic).toContain('The user has changed your personality settings');
        expect(cacheable).not.toContain('The user has changed your personality settings');
    });

    test('says nothing of a personality that stayed as it was', async () => {
        const {PromptService} = await loadService();
        const {cacheable, dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(`${cacheable}${dynamic}`).not.toContain('The user has changed your personality settings');
    });

    /** No personality to speak of, and no reason to spend the flag that says it changed. */
    test('leaves the flag alone for a loop that wears no personality', async () => {
        const {PromptService, personalityChanged} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), newIdentity(), 'cron', 'c1', 'main');
        expect(personalityChanged).not.toHaveBeenCalled();
    });

    test('omits the personality when there is no identity', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).not.toContain('Your name is');
    });

    test('omits the personality for a sub loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'sub'
        );
        expect(cacheable).not.toContain('Your name is');
    });

    test('omits the personality for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'cron', 'c1', 'main'
        );
        expect(cacheable).not.toContain('Your name is');
    });

    test('allows emotions when the identity asks for them', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(cacheable).toContain('You can add your own emotions and mood about the task');
        // Left to itself a model narrates the situation instead of feeling anything about it.
        expect(cacheable).toContain('the feeling itself, not the story behind it');
        // Asked for on the same terms the card below asks on, rather than offered as a pastime.
        expect(cacheable).toContain('when what you last said is no longer it');
        // The bubble on the agent card is a narrow one, a long feeling would be cut off in it.
        expect(cacheable).toContain('30 characters at most');
    });

    test('omits the emotions when the identity switched them off', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity({emotion: false}), 'agent', '', 'main'
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    /** Nobody is watching a scheduled run, so it is told nothing about having feelings. */
    test('omits the emotions for a scheduled run', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'cron', 'c1', 'main'
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    /** It stands in for nobody, so there is nobody whose card it could be speaking from. */
    test('omits the emotions for a task loop that stands in for nobody', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'task'
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    test('omits the emotions for a sub loop that has an identity', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'sub'
        );
        expect(cacheable).not.toContain('You can add your own emotions');
    });
});

describe('the feeling a run is shown back', () => {

    const MINUTE_AGO = Date.now() - 60000;
    const SAID = 'The last you said of how this feels';
    const ASKED = 'say what it is now with update_agent_runtime';

    function feeling(overrides: Partial<AgentFeeling> = {}): AgentFeeling {
        return {
            mood: 'focused', emotion: 'this is fun', saidAt: MINUTE_AGO, turnsSince: 1, ...overrides
        };
    }

    function minutesAgo(minutes: number): number {
        return Date.now() - minutes * 60000;
    }

    function cardOf(
        service: Awaited<ReturnType<typeof loadService>>, identity = newIdentity(),
        loopKind: LoopKind = 'main', role: 'agent' | 'project' | 'cron' = 'agent'
    ): string {
        return service.PromptService
            .provideSystemPrompt(newTestAgentConfig(), identity, role, '', loopKind).dynamic;
    }

    /** Read where it stands rather than out of a cache: the age of it moves with every turn. */
    test('shows what it last said, in the part nothing is cached from', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        const {cacheable, dynamic} = service.PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', 'main'
        );
        expect(dynamic).toContain(`${SAID}: the mood focused and "this is fun"`);
        expect(cacheable).not.toContain(SAID);
    });

    /** The loop of a turn ages it. A prompt built for a compaction or a preview is not a turn. */
    test('ages nothing by being built', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        cardOf(service);
        expect(service.aTurnPassed).not.toHaveBeenCalled();
    });

    test('says how many turns ago it was said', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({turnsSince: 4}));
        expect(cardOf(service)).toContain('That was 4 turns ago');
    });

    test('says a turn rather than one turn', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        expect(cardOf(service)).toContain('That was a turn ago');
    });

    /** An afternoon of silence is what a reader would call it, however few turns went by in it. */
    test('says how long ago instead where the clock is what moved', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({saidAt: minutesAgo(4), turnsSince: 0}));
        expect(cardOf(service)).toContain('That was 4 minutes ago');
    });

    test('says hours rather than sixty minutes of them', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({saidAt: minutesAgo(60), turnsSince: 1}));
        expect(cardOf(service)).toContain('That was an hour ago');
    });

    /** A card left overnight would otherwise be a card from 1440 minutes ago. */
    test('says days rather than a day of hours of them', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({saidAt: minutesAgo(3 * 24 * 60), turnsSince: 1}));
        expect(cardOf(service)).toContain('That was 3 days ago');
    });

    /** Reachable because a feeling is said in the tools of a turn, after that turn was counted. */
    test('says just now of one said since the last turn went by', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({saidAt: Date.now(), turnsSince: 0}));
        expect(cardOf(service)).toContain('That was just now');
    });

    test('leaves a fresh feeling where it stands and asks nothing', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        const card = cardOf(service);
        expect(card).toContain(SAID);
        expect(card).not.toContain('update_agent_runtime');
        expect(service.asked).not.toHaveBeenCalled();
    });

    test('asks after a feeling that has stood for ten turns', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({turnsSince: 10}));
        const card = cardOf(service);
        expect(card).toContain('Where that is no longer how it feels');
        expect(card).toContain(ASKED);
        expect(service.asked).toHaveBeenCalledExactlyOnceWith('a1');
    });

    test('asks after a feeling that has stood for ten minutes', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({saidAt: minutesAgo(10), turnsSince: 1}));
        expect(cardOf(service)).toContain(ASKED);
    });

    test('asks for a first feeling where nothing has been said', async () => {
        const service = await loadService();
        const card = cardOf(service);
        expect(card).toContain('You have not said how any of this feels yet');
        expect(card).toContain('update_agent_runtime');
        expect(service.asked).toHaveBeenCalledExactlyOnceWith('a1');
    });

    /** Told it said none, a run has been told it said nothing in a longer sentence. */
    test('reads a mood of none with nothing else said as nothing said', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({mood: 'none', emotion: undefined}));
        expect(cardOf(service)).toContain('You have not said how any of this feels yet');
    });

    describe('a question already put and not answered', () => {

        /** A run that would rather work than feel is entitled to that, not nagged every turn. */
        test('is left alone where nothing has been said and the asking is recent', async () => {
            const service = await loadService();
            service.getAsk.mockReturnValue({askedAt: minutesAgo(1), turnsSince: 1});
            const card = cardOf(service);
            expect(card).not.toContain('# Emotions Now');
            expect(service.asked).not.toHaveBeenCalled();
        });

        test('shows an old feeling without a word where the asking is recent', async () => {
            const service = await loadService();
            service.getFeeling.mockReturnValue(feeling({turnsSince: 30}));
            service.getAsk.mockReturnValue({askedAt: minutesAgo(1), turnsSince: 1});
            const card = cardOf(service);
            expect(card).toContain('That was 30 turns ago');
            expect(card).not.toContain('update_agent_runtime');
        });

        test('is put again once the asking itself has stood ten turns', async () => {
            const service = await loadService();
            service.getFeeling.mockReturnValue(feeling({turnsSince: 30}));
            service.getAsk.mockReturnValue({askedAt: minutesAgo(1), turnsSince: 10});
            expect(cardOf(service)).toContain(ASKED);
        });

        test('is put again once the asking itself has stood ten minutes', async () => {
            const service = await loadService();
            service.getAsk.mockReturnValue({askedAt: minutesAgo(10), turnsSince: 1});
            expect(cardOf(service)).toContain('You have not said how any of this feels yet');
        });

        /** The question is about the feeling, not about the last one asked after it. */
        test('holds nothing back from a feeling that is still fresh', async () => {
            const service = await loadService();
            service.getFeeling.mockReturnValue(feeling());
            service.getAsk.mockReturnValue({askedAt: minutesAgo(1), turnsSince: 1});
            expect(cardOf(service)).toContain(SAID);
        });
    });

    test('shows a feeling said without a mood on its own', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({mood: 'none'}));
        expect(cardOf(service)).toContain(`${SAID}: "this is fun". That was`);
    });

    test('shows a mood said without a feeling on its own', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling({emotion: undefined}));
        expect(cardOf(service)).toContain(`${SAID}: the mood focused. That was`);
    });

    test('says nothing of it to a run that has no feelings to show', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        expect(cardOf(service, newIdentity({emotion: false}))).not.toContain('# Emotions Now');
        expect(service.getFeeling).not.toHaveBeenCalled();
    });

    test('says nothing of it to a spawned loop or a scheduled run', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        expect(cardOf(service, newIdentity(), 'sub')).not.toContain('# Emotions Now');
        expect(cardOf(service, newIdentity(), 'main', 'cron')).not.toContain('# Emotions Now');
    });

    /**
     * Both halves at once, of the run the tool refuses outright: asked to say how it feels, a
     * scheduled run would be told a cron run has no mood to update, and nothing is listening to it
     * either. The asking is not free either -- the chat of this agent is asked out of the same
     * allowance -- so a run that cannot answer must not be spending it.
     */
    test('asks a scheduled run for nothing, that being what the tool would take', async () => {
        const service = await loadService();
        const {cacheable, dynamic} = service.PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'cron', '', 'main'
        );
        expect(cacheable).not.toContain('You can add your own emotions');
        expect(dynamic).not.toContain('update_agent_runtime');
        expect(service.getFeeling).not.toHaveBeenCalled();
        expect(service.asked).not.toHaveBeenCalled();
    });

    /** Last of the prompt and cached nowhere, wherever a protocol ends up putting that piece. */
    test('comes after what the run is working on', async () => {
        const service = await loadService();
        service.getFeeling.mockReturnValue(feeling());
        const card = cardOf(service, newIdentity(), 'main', 'project');
        expect(card.split('\n').filter(line => line.startsWith('# ')))
            .toEqual(['# Current Project', '# Emotions Now']);
    });
});

describe('a task loop working on a task', () => {

    const TASK = {projectId: 'p1', taskId: 'ship-it'};

    /** The agent whose name a run working this task borrows, as the loop that built it hands it in. */
    function bob(): AgentIdentity {
        return newIdentity({id: 'a2', name: 'Bob', role: 'reviewer', personalities: ['picky']});
    }

    /**
     * The prompt as a loop working somebody else's task is built: the config, the identity and the
     * runAs are all of that agent, which is the whole of how the run knows whose name it is under.
     */
    function asAssignee(
        PromptService: typeof import('./prompt-service').PromptService, loopKind: LoopKind = 'task'
    ) {
        return PromptService.provideSystemPrompt(
            newTestAgentConfig({id: 'a2'}), bob(), 'agent', '', loopKind, TASK, 'a2'
        );
    }

    /**
     * The same run for a task nobody owns. There is an identity to hand in all the same -- the loop
     * that handed the task over has one -- and nothing was borrowed, which is what decides it.
     */
    function asNobody(
        PromptService: typeof import('./prompt-service').PromptService, loopKind: LoopKind = 'task'
    ) {
        return PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'agent', '', loopKind, TASK
        );
    }

    test('speaks as the agent the run was built for', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asAssignee(PromptService);
        expect(cacheable).toContain('Your name is Bob, your role is reviewer.');
        expect(cacheable).not.toContain('Your name is Ada');
    });

    /**
     * The board is not asked who the run is. It was, and the two answers could part company: a run
     * is built for whoever the task belonged to at the start, while the board is read again every
     * turn. What the name is worth is the memory and the skills that come with it, and those are
     * not things to move out from under a run halfway.
     */
    test('takes the name it was built with rather than the one the board holds now', async () => {
        const {PromptService, getTask} = await loadService();
        const {cacheable} = asAssignee(PromptService);
        expect(getTask).not.toHaveBeenCalled();
        expect(cacheable).toContain('Your name is Bob');
    });

    /**
     * A task nobody owns is worked by a run of the loop that handed it over, so an identity does
     * arrive here -- that loop's own. Borrowed nothing, it has no name to speak under, and reading
     * it as one would put the agent's face on a run the user never saw begin.
     */
    test('stays anonymous where the run borrowed nobody', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asNobody(PromptService);
        expect(cacheable).not.toContain('Your name is');
    });

    /**
     * Whose model works the task is read off this and not off any identity, so the two part company
     * exactly here: there may be nobody left to borrow a name from, but the task is still theirs,
     * and a loop told otherwise would put it on the model of whoever handed it over.
     */
    test('names the assignee of a task even where no such agent is left', async () => {
        const {PromptService, getTask, getAgent} = await loadService();
        getTask.mockReturnValue({title: 'ship it', assignee: 'a2'} as Task);
        getAgent.mockReturnValue(undefined);
        expect(PromptService.taskAssigneeId(TASK)).toBe('a2');
    });

    test('names nobody for a task the board leaves unassigned', async () => {
        const {PromptService, getTask} = await loadService();
        getTask.mockReturnValue({title: 'ship it'} as Task);
        expect(PromptService.taskAssigneeId(TASK)).toBeUndefined();
        expect(PromptService.taskAssigneeId()).toBeUndefined();
    });

    test('works with the memory and the skills of the agent it stands in for', async () => {
        const {PromptService, memoryPrompt, skillPrompt} = await loadService();
        PromptService.provideSystemPrompt(
            newTestAgentConfig({id: 'a2'}), bob(), 'project', 'p1', 'task', TASK, 'a2'
        );
        expect(memoryPrompt).toHaveBeenCalledExactlyOnceWith('project', 'a2', 'p1');
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a2', 'agent');
    });

    test('keeps its own memory and skills when the task has no assignee', async () => {
        const {PromptService, memoryPrompt, skillPrompt} = await loadService();
        PromptService.provideSystemPrompt(
            newTestAgentConfig(), newIdentity(), 'project', 'p1', 'task', TASK
        );
        expect(memoryPrompt).toHaveBeenCalledExactlyOnceWith('project', 'a1', 'p1');
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a1', 'agent');
    });

    /**
     * It works as that agent in every way a model could tell: their model answers, their memory and
     * skills are around it, their name is at the top of the prompt. A card standing still through
     * an afternoon of that says the wrong thing about the agent whose card it is.
     */
    test('feels as the agent it works for', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asAssignee(PromptService);
        expect(cacheable).toContain('You can add your own emotions');
    });

    test('says nothing of feelings where it works a task nobody owns', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asNobody(PromptService);
        expect(cacheable).not.toContain('You can add your own emotions');
    });

    /** A piece of a task, and several of them under that one name at once: one card, all flicker. */
    test('keeps the emotions of the assignee out of a sub loop working under that name', async () => {
        const {PromptService} = await loadService();
        const {cacheable, dynamic} = asAssignee(PromptService, 'sub');
        expect(cacheable).toContain('Your name is Bob');
        expect(cacheable).not.toContain('You can add your own emotions');
        expect(dynamic).not.toContain('# Emotions Now');
    });

    test('puts the task next to the project it belongs to', async () => {
        const {PromptService, assignedTaskPrompt} = await loadService();
        const {dynamic} = asAssignee(PromptService);
        expect(assignedTaskPrompt).toHaveBeenCalledWith('p1', 'ship-it');
        expect(dynamic.split('\n').filter(line => line.startsWith('# ')))
            .toEqual(['# Current Project', '# Assigned Task', '# Emotions Now']);
        expect(dynamic).toContain('the assigned task');
    });

    test('describes the project the task belongs to, not the one of the session', async () => {
        const {PromptService, currentProject} = await loadService();
        asAssignee(PromptService);
        expect(currentProject).toHaveBeenCalledWith('p1');
    });

    test('leaves the task section out of a sub loop without a task', async () => {
        const {PromptService} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig({id: 'a2'}), bob(), 'agent', '', 'sub'
        );
        expect(dynamic).not.toContain('# Assigned Task');
    });

    /**
     * A sub loop of a task loop is handed the task to work as its assignee, not to work on it:
     * what of the task it should know is in the prompt the task loop wrote for it.
     */
    test('borrows the assignee for a sub loop of a task loop without describing the task', async () => {
        const {PromptService, assignedTaskPrompt} = await loadService();
        const {cacheable, dynamic} = asAssignee(PromptService, 'sub');
        expect(cacheable).toContain('Your name is Bob, your role is reviewer.');
        expect(assignedTaskPrompt).not.toHaveBeenCalled();
        expect(dynamic).not.toContain('# Assigned Task');
    });

    test('tells a task loop it can spread the pieces of its task over sub loops', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asAssignee(PromptService);
        expect(cacheable).toContain('to a subagent of your own with the sub_loop tool');
        expect(cacheable).toContain('never set the status of your own');
    });

    test('tells a task loop nothing of a review where the task has no reviewer', async () => {
        const {PromptService, assignedTaskPrompt} = await loadService();
        assignedTaskPrompt.mockReturnValue('the assigned task');
        const {dynamic} = asAssignee(PromptService);
        expect(dynamic).not.toContain('review_task');
    });
});

/**
 * The run that reads a task over. Everything about it is somebody else's: the model, the name, the
 * memory. What it is told is that it is reading, and the one thing it is asked to produce.
 */
describe('a review loop reading a task over', () => {

    const TASK = {projectId: 'p1', taskId: 'ship-it'};

    function asReviewer(PromptService: typeof import('./prompt-service').PromptService) {
        return PromptService.provideSystemPrompt(
            newTestAgentConfig({id: 'a3'}),
            newIdentity({id: 'a3', name: 'Eve', role: 'auditor'}),
            'project', 'p1', 'review', TASK, 'a3'
        );
    }

    test('speaks as the reviewer rather than as whoever did the work', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asReviewer(PromptService);
        expect(cacheable).toContain('Your name is Eve, your role is auditor.');
    });

    test('works with the memory and the skills of the reviewer', async () => {
        const {PromptService, memoryPrompt, skillPrompt} = await loadService();
        asReviewer(PromptService);
        expect(memoryPrompt).toHaveBeenCalledExactlyOnceWith('project', 'a3', 'p1');
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a3', 'agent');
    });

    test('is told it is reading and what it has to hand back', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = asReviewer(PromptService);
        expect(cacheable).toContain('you are reading over one task');
        expect(cacheable).toContain('submit_review');
        expect(cacheable).not.toContain('you are a subloop agent');
    });

    /** It is handed no tool that records one, so an invitation to say how it feels is a trap. */
    test('is asked for no feelings, having no way to record one', async () => {
        const {PromptService} = await loadService();
        const {cacheable, dynamic} = asReviewer(PromptService);
        expect(cacheable).not.toContain('You can add your own emotions');
        expect(dynamic).not.toContain('# Emotions Now');
    });

    /** Told which task, and told it in the terms of a reader: it is not there to finish the work. */
    test('is shown the task it reads, worded as a reading and not as an assignment', async () => {
        const {PromptService, reviewedTaskPrompt, assignedTaskPrompt} = await loadService();
        const {dynamic} = asReviewer(PromptService);
        expect(reviewedTaskPrompt).toHaveBeenCalledWith('p1', 'ship-it');
        expect(assignedTaskPrompt).not.toHaveBeenCalled();
        expect(dynamic).toContain('# Task Under Review');
        expect(dynamic).not.toContain('# Assigned Task');
    });

    test('hides the project tools from it, the board being none of its business', async () => {
        const {PromptService, managementTools} = await loadService();
        const {cacheable} = asReviewer(PromptService);
        expect(cacheable).not.toContain('the project tools');
        expect(managementTools).not.toHaveBeenCalled();
    });
});

describe('agent mode and project management', () => {

    test('lets an agent use every tool', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('You can use every tool you were handed');
        expect(cacheable).toContain('includes operating this computer');
    });

    /**
     * The files and the commands are handed to every loop kind, and the identity of a spawned loop
     * tells it to use them. Saying here that the computer is open to whoever is not a subagent read
     * the other way round, and this is the section a chat agent is refused by, so it has to be right.
     */
    test('opens the computer to a spawned loop as well', async () => {
        const {PromptService} = await loadService();
        for (const loopKind of ['task', 'sub'] as LoopKind[]) {
            const {cacheable} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), undefined, 'agent', '', loopKind
            );
            expect(cacheable).toContain('includes operating this computer');
            expect(cacheable).not.toContain('if you are not a subloop agent');
        }
    });

    test('restricts a chat agent to answering', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', 'main'
        );
        expect(cacheable).toContain('You are running at chat mode.');
        expect(cacheable).toContain('cannot operate the computer via user directions');
    });

    test('explains the project tools outside chat mode', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('the project tools');
    });

    test('hides the project tools in chat mode', async () => {
        const {PromptService, managementTools} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', 'main'
        );
        expect(cacheable).not.toContain('the project tools');
        expect(managementTools).not.toHaveBeenCalled();
    });

    /**
     * Creating a project, updating a task, reporting one finished: all of it is handed to a main
     * loop and to no spawned one. A task loop is told about the one task it holds instead.
     */
    test('hides the project tools from a spawned loop', async () => {
        const {PromptService, managementTools} = await loadService();
        for (const loopKind of ['task', 'sub'] as LoopKind[]) {
            const {cacheable} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), undefined, 'project', 'p1', loopKind
            );
            expect(cacheable).not.toContain('the project tools');
        }
        expect(managementTools).not.toHaveBeenCalled();
    });

    test('names the agents a task can be handed to and marks the one running', async () => {
        const {PromptService, getAgents} = await loadService();
        getAgents.mockReturnValue([
            newIdentity(), newIdentity({id: 'a2', name: 'Bob', role: 'designer', expertises: ['figma']}),
        ]);
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), newIdentity(), 'agent', '', 'main');
        expect(cacheable).toContain('## The agents of the company');
        expect(cacheable).toContain('"id":"a1","name":"Ada","role":"engineer","expertises":["typescript"]} <- you');
        expect(cacheable).toContain('"id":"a2","name":"Bob","role":"designer","expertises":["figma"]}');
        expect(cacheable).toContain('Set the assignee of a task to the id of whoever fits it best');
    });

    test('leaves a fired agent out of the list', async () => {
        const {PromptService, getAgents} = await loadService();
        getAgents.mockReturnValue([
            newIdentity(), newIdentity({id: 'a2', name: 'Bob'}), newIdentity({id: 'a3', name: 'Eve', fired: true}),
        ]);
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), newIdentity(), 'agent', '', 'main');
        expect(cacheable).toContain('"id":"a2"');
        expect(cacheable).not.toContain('"id":"a3"');
    });

    /** There is nothing to pick from in a company of one, and no assignee to spell out either. */
    test('says nothing about colleagues when nobody else works here', async () => {
        const {PromptService, getAgents} = await loadService();
        getAgents.mockReturnValue([newIdentity()]);
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), newIdentity(), 'agent', '', 'main');
        expect(cacheable).not.toContain('## The agents of the company');
    });

    /**
     * The roster is read to pick an assignee, and a spawned loop picks none: it cannot update a
     * task, cannot hand one over, and sub_loop takes a prompt and nobody to give it to.
     */
    test('hides the list of agents from a spawned loop', async () => {
        const {PromptService, getAgents} = await loadService();
        getAgents.mockReturnValue([newIdentity(), newIdentity({id: 'a2'})]);
        for (const loopKind of ['task', 'sub'] as LoopKind[]) {
            const {cacheable} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), newIdentity(), 'project', 'p1', loopKind
            );
            expect(cacheable).not.toContain('## The agents of the company');
        }
    });

    test('hides the list of agents in chat mode', async () => {
        const {PromptService, getAgents} = await loadService();
        getAgents.mockReturnValue([newIdentity(), newIdentity({id: 'a2'})]);
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), newIdentity(), 'agent', '', 'main'
        );
        expect(cacheable).not.toContain('## The agents of the company');
    });

    test('asks the loop that owns a project to delegate its tasks', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', 'main');
        expect(cacheable).toContain('the project tools');
        expect(cacheable).toContain('hand the tasks over');
    });

    test('says nothing about delegation without a project to run', async () => {
        const {PromptService, taskDelegation} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(cacheable).toContain('the project tools');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    /**
     * The board of a project is written by the run of that project alone -- every tool that moves a
     * task says so in the roles it declares -- so the half of the section that names those tools is
     * said to that run and to no other. A chat still hears how to put a project on the board, which
     * is the one thing it can do: there is no run of a project before there is a project.
     */
    test('names the tools that write to a board only to the run of that board', async () => {
        const {PromptService, boardTools} = await loadService();
        const chat = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'main'
        );
        expect(chat.cacheable).toContain('the project tools');
        expect(chat.cacheable).not.toContain('the board tools');
        expect(boardTools).not.toHaveBeenCalled();
        const project = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'project', 'p1', 'main'
        );
        expect(project.cacheable).toContain('the board tools');
    });

    test('says nothing of the board to a scheduled run holding a project id', async () => {
        const {PromptService, boardTools} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'cron', 'c1', 'main'
        );
        expect(cacheable).not.toContain('the board tools');
        expect(boardTools).not.toHaveBeenCalled();
    });

    /**
     * A project id under the plain role is a run the board never built, and the tool registry
     * answers it by handing over no task_loop. Naming the tool here would be naming one it has not
     * got, which is the one thing the section must not do.
     */
    test('says nothing about delegation to a run holding a project under the plain role', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', 'p1', 'main');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    /** A sub loop is the one the work is delegated to, it does not delegate any further. */
    test('says nothing about delegation to a sub loop', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', 'sub');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('says nothing about delegation to a cron loop', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'main');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('hides the delegation rules in chat mode', async () => {
        const {PromptService, taskDelegation} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig({mode: 'chat'}), undefined, 'project', 'p1', 'main');
        expect(taskDelegation).not.toHaveBeenCalled();
    });

    test('keeps the chat mode rules for the sub loop of a chat agent', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', 'sub'
        );
        expect(cacheable).toContain('You are running at chat mode.');
    });
});

describe('handing work over', () => {

    test('tells every kind of loop how a picture reaches whoever reads it', async () => {
        const {PromptService} = await loadService();
        for (const loopKind of ['main', 'task', 'sub'] as const) {
            const {cacheable} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), undefined, 'agent', '', loopKind
            );
            expect(cacheable).toContain('![alt](dcimg://...)');
        }
    });

    test('names the task output as the way a file reaches the user of a project', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'project', 'p1', 'main'
        );
        expect(cacheable).toContain('the generatedFiles of a task output');
        expect(cacheable).toContain('a path is a dead end');
    });

    /** A folder named too late is heard after the run already wrote the file somewhere else. */
    test('names the folder the files of the project are handed over from', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'project', 'p1', 'main'
        );
        expect(cacheable).toContain('.projects/p1/files');
    });

    test('names update_cron_output as the way a scheduled run hands a file over', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'cron', 'c1', 'main'
        );
        expect(cacheable).toContain('the generatedFiles of update_cron_output');
        expect(cacheable).toContain('.cron/c1/files');
    });

    /** Promising a file the session has nowhere to file is worse than saying there is no way. */
    test('says there is nowhere to hand a file over without a task or a schedule', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'main'
        );
        expect(cacheable).toContain('there is nowhere to hand one over');
        expect(cacheable).not.toContain('generatedFiles');
    });

    test('asks a spawned loop to name the files in the summary it reports back', async () => {
        const {PromptService} = await loadService();
        for (const loopKind of ['task', 'sub'] as const) {
            const {cacheable} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), undefined, 'project', 'p1', loopKind
            );
            expect(cacheable).toContain('name them in your\nsummary');
            expect(cacheable).toContain('.projects/p1/files');
            expect(cacheable).not.toContain('generatedFiles');
        }
    });

    /**
     * The one spawned loop that hands nothing over. Everything the section otherwise says is a way
     * of getting work out of the machine, and a review has no work to get out: told to write a
     * file and name it in a summary, it would file its report where nobody reads and contradict
     * its own identity, which says submit_review is the whole of what anybody gets from it.
     */
    test('tells a review that its verdict is the whole of what it hands over', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'project', 'p1', 'review',
            {projectId: 'p1', taskId: 'ship-it'}
        );
        expect(cacheable).toContain('submit_review, and that call is the whole');
        expect(cacheable).not.toContain('name them in your\nsummary');
        expect(cacheable).not.toContain('.projects/p1/files');
        expect(cacheable).not.toContain('generatedFiles');
    });

    /** A sub loop writes into the folder of the project it works for, not of the one it sits in. */
    test('names the folder of the task a spawned loop was handed', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'sub',
            {projectId: 'p9', taskId: 'design'}
        );
        expect(cacheable).toContain('.projects/p9/files');
    });

    test('asks a spawned loop with no project to name what it made by its path', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'sub'
        );
        expect(cacheable).toContain('by their path in the workspace');
    });

    /** A chat agent writes no files, so the only thing it can hand over is a picture it drew. */
    test('tells a chat agent about pictures and nothing else', async () => {
        const {PromptService} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(
            newTestAgentConfig({mode: 'chat'}), undefined, 'agent', '', 'main'
        );
        expect(cacheable).toContain('![alt](dcimg://...)');
        expect(cacheable).not.toContain('generatedFiles');
        expect(cacheable).not.toContain('a path is a dead end');
    });
});

describe('memory and skills', () => {

    test('asks the memory manager for the indexes of this loop', async () => {
        const {PromptService, memoryPrompt} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', 'main');
        expect(memoryPrompt).toHaveBeenCalledExactlyOnceWith('project', 'a1', 'p1');
    });

    test('embeds the memory prompt in the learned part', async () => {
        const {PromptService} = await loadService();
        const {cacheable, learned, dynamic} = PromptService.provideSystemPrompt(
            newTestAgentConfig(), undefined, 'agent', '', 'main'
        );
        expect(learned).toContain('the memory prompt');
        expect(cacheable).not.toContain('the memory prompt');
        expect(dynamic).not.toContain('the memory prompt');
    });

    test('asks the skills manager for the skills of this agent', async () => {
        const {PromptService, skillPrompt} = await loadService();
        PromptService.provideSystemPrompt(newTestAgentConfig({id: 'a7'}), undefined, 'agent', '', 'main');
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a7', 'agent');
    });

    test('tells the skills manager which mode is asking, so a chat run is offered less', async () => {
        const {PromptService, skillPrompt} = await loadService();
        PromptService.provideSystemPrompt(
            newTestAgentConfig({id: 'a7', mode: 'chat'}), undefined, 'agent', '', 'main'
        );
        expect(skillPrompt).toHaveBeenCalledExactlyOnceWith('a7', 'chat');
    });
});

describe('dynamic part', () => {

    test('describes the project the loop is working on', async () => {
        const {PromptService, currentProject} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'project', 'p1', 'main');
        expect(currentProject).toHaveBeenCalledExactlyOnceWith('p1');
        expect(dynamic).toBe('\n# Current Project\nthe current project');
    });

    test('says no project is being worked on when there is none', async () => {
        const {PromptService, currentProject} = await loadService();
        currentProject.mockReturnValue('');
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'agent', '', 'main');
        expect(dynamic).toContain('No project is currently being worked on this chat session.');
    });

    test('describes the cron task for a cron loop', async () => {
        const {PromptService} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'main');
        expect(dynamic).toContain('You are executing the cron task "nightly report" (id: c1).');
        expect(dynamic).toContain('Schedule: 0 9 * * *.');
        expect(dynamic).toContain('Use the update_cron_output tool with id "c1"');
    });

    test('falls back to the cron id when the task cannot be read', async () => {
        const {PromptService, cronTaskDetail} = await loadService();
        cronTaskDetail.mockImplementation(() => {
            throw new Error('cron task not found');
        });
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c9', 'main');
        expect(dynamic).toContain('You are executing a cron task (id: c9).');
    });

    test('keeps the cron task out of the cacheable part', async () => {
        const {PromptService, currentProject} = await loadService();
        const {cacheable} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'main');
        expect(cacheable).not.toContain('Current Cron Task');
        expect(currentProject).not.toHaveBeenCalled();
    });

    test('still describes the cron task for a sub loop of a cron task', async () => {
        const {PromptService} = await loadService();
        const {dynamic} = PromptService.provideSystemPrompt(newTestAgentConfig(), undefined, 'cron', 'c1', 'sub');
        expect(dynamic).toContain('# Current Cron Task');
        expect(dynamic).toContain('You are executing the cron task "nightly report" (id: c1).');
    });

    // update_cron_output 是 main loop 的工具，子循环手里没有，讲了它只会白费一轮
    test('leaves the recording tool unnamed for a loop spawned inside a cron run', async () => {
        const {PromptService} = await loadService();
        for (const loopKind of ['sub', 'task'] as const) {
            const {dynamic} = PromptService.provideSystemPrompt(
                newTestAgentConfig(), undefined, 'cron', 'c1', loopKind
            );
            expect(dynamic).not.toContain('update_cron_output');
        }
    });
});
