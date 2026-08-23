import {
    type AgentInteractionEventPayload, isInternalInterruptReason, isInvalidInteractionReason
} from "@deepclaw/core";
import { OneLoopContext } from "../../definitions/definitions";
import { ToolDesc } from "../../definitions/tool-definitions";
import { ToolUseService } from "../services/tool-use-service";

const MAX_OPTIONS = 6;

type AskUserInput = {
    question: string;
    options?: string[];
}

export const askUserTool: ToolDesc<AskUserInput> = {
    tool: {
        name: 'ask_user',
        description: `Put a question to the user and wait for the answer before going on. The run
stands still until it comes, so this is for what only the user can settle: which of several ways to
take, whether something that cannot be undone should really be done, which of two readings of the
request is the one meant.

Do not ask what you can find out yourself, and do not ask to report progress or to be told to
carry on: every question stops the work in front of a person. Ask once for what you need rather
than a question per step, and go on with the answer without asking it back.`,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                question: {
                    type: 'string',
                    description: `The question, written for the user: what you are about to do and
what you need of them. Say it in the language the user writes in.`,
                },
                options: {
                    type: 'array',
                    items: {type: 'string'},
                    minItems: 2,
                    maxItems: MAX_OPTIONS,
                    description: `The answers to choose between, when the answer is a choice. The
user picks one of them and it comes back as it is written here. Leave this out to have the user
write the answer instead.`,
                },
            },
            required: ['question'],
        },
    },
    agentMode: ['agent'],
    // The run waits for a person, and a person answers one thing at a time.
    parallelSafe: false,
    invoke: async function(input: AskUserInput, context: OneLoopContext): Promise<string> {
        const question = input.question?.trim();
        if (!question) {
            return 'Nothing was asked: a question is needed to ask one.';
        }
        // A schedule is set up by somebody who will not be there when it runs, and a cron run
        // carries no browser for a question to be put in: the gateway turns one away as it comes.
        // Said here, the refusal is one the model can do something about rather than a dead end.
        if (context.role === 'cron') {
            return `This run was scheduled, so there is nobody to ask. Decide it yourself and say in
the output what you decided and why, or leave the work for the user to pick up.`;
        }
        const {asked, dropped} = questionOf(input, question);
        try {
            const answer = await ToolUseService.askQuestion(asked, context);
            return !answer.trim()
                ? 'The user closed the question without answering it.'
                : `The user answered: ${answer}${droppedNote(dropped)}`;
        } catch (error: any) {
            if (isInternalInterruptReason(error)) {
                return `Nobody answered in time, so the question stands unanswered. Go on with what
you can settle yourself, or stop and say what you needed to know.`;
            }
            if (isInvalidInteractionReason(error)) {
                return `There is nobody to ask right now, so the question was not put. Go on with
what you can settle yourself, or stop and say what you needed to know.`;
            }
            return `Asking failed: ${error}`;
        }
    },
};

/** The question as it goes to the user, and the answers that did not fit in front of them. */
function questionOf(
    input: AskUserInput, question: string
): {asked: AgentInteractionEventPayload; dropped: string[]} {
    // Options are handed over as plain strings, which the answer comes back as: what the user
    // picked reads in the answer as it read on the button, with nothing to look it up by.
    const options = input.options?.map(option => option.trim()).filter(option => !!option) ?? [];
    if (options.length < 2) {
        return {asked: {type: 'input', content: question}, dropped: []};
    }
    // The schema of the tool asks for the cap, only a well behaved model keeps to what it asks. A
    // question is read whole before it is answered, and a list nobody reads to the end is a choice
    // made out of the top of it.
    return {
        asked: {type: 'select', content: question, options: options.slice(0, MAX_OPTIONS)},
        dropped: options.slice(MAX_OPTIONS),
    };
}

/** What never reached the user has to be said, or the answer is read as a choice against it. */
function droppedNote(dropped: string[]): string {
    if (!dropped.length) {
        return '';
    }
    return `

Only the first ${MAX_OPTIONS} answers were put to the user, so the choice was made without these:
${dropped.join(', ')}. Ask again with fewer answers where one of them still matters.`;
}
