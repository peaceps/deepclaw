import type {
    AgentHandler, AgentInfoEvent, AgentInteractionEvent, AgentStreamEvent
} from '@deepclaw/core';

/**
 * The handler side of a trace: the answer as the user would see it, the questions the agent
 * asked, and the project/agent changes it announced. Tool signals do not come through here,
 * they come from the hooks.
 */
export class TraceHandler implements AgentHandler {

    public streamedText = '';
    public readonly infoEvents: AgentInfoEvent[] = [];
    public readonly unexpectedInteractions: string[] = [];

    private readonly answers: Record<string, string>;

    constructor(answers: Record<string, string> = {}) {
        this.answers = answers;
    }

    public onStreamText(event: AgentStreamEvent): void {
        this.streamedText += event.text || '';
    }

    public async onInteractionEvent(event: AgentInteractionEvent): Promise<string> {
        const question = event.content || '';
        const answer = Object.entries(this.answers).find(([key]) => question.includes(key));
        if (!answer) {
            // Nobody is at the keyboard in an eval, so an unforeseen question is a finding of
            // its own: it usually means the prompt asks for something the scenario never said.
            this.unexpectedInteractions.push(question);
            return '';
        }
        return answer[1];
    }

    public onInfoEvent(event: AgentInfoEvent): void {
        this.infoEvents.push(event);
    }
}
