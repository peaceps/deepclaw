import {
    isInfoEvent, isLoopBusyEvent, isLoopCancelInteractionEvent,
    isLoopChatEvent, isLoopInteractionEvent, isLoopStreamEvent,
    LoopGateway, LoopGatewayEvent,
    isLoopTokenUsageEvent, isLoopSessionResetEvent
} from "@deepclaw/loop-gateway";
import { globalize } from "@deepclaw/utils";
import { getLogger } from "@deepclaw/node-utils";
import type { AgentInteractionEvent } from "@deepclaw/core";
import {
    type SSEClient,
    type SSEEvent,
    SSEToastEvent,
} from "./sse-types";

/**
 * One stream carries everything a browser is told. A browser only opens about six connections to a
 * host, so a stream per loop on top of the shared one spent them on listening alone and left the
 * page unable to even load another route: whatever is watched travels with the client instead.
 */
class SSEServerImpl {
    // TODO
    private static logger = getLogger('SSEServer');
    private static clients: Map<string, SSEClient> = new Map();
    private static unsubscriber?: () => void;
    private static streamSeq = 0;

    /** Answers with which stream of that browser this is, which is what ends it again. */
    public static addClient(
        browserId: string, controller: ReadableStreamDefaultController, encoder: TextEncoder
    ): number {
        this.unsubscriber ??= LoopGateway.subscribe((e: LoopGatewayEvent) => {
            this.broadcastEvent(e);
        });
        const streamId = ++this.streamSeq;
        this.clients.set(browserId, {browserId, streamId, loops: new Set(), controller, encoder});
        // A question left behind by a browser that closed has nobody waiting for it, and this one is
        // here now: it is told so, and handed the question itself when it opens that loop.
        this.orphanQuestions().forEach(question =>
            this.sendToast({key: 'interactionPause', data: question.loopId}, browserId));
        return streamId;
    }

    /**
     * Which loops a browser shows, told by the view that opened or left. The events of a loop
     * nobody looks at are a stream of tokens sent for nothing.
     */
    public static watchLoop(browserId: string, loopId: string, watching: boolean): void {
        const client = this.clients.get(browserId);
        if (!client) {
            return;
        }
        if (!watching) {
            client.loops.delete(loopId);
            return;
        }
        client.loops.add(loopId);
        this.askAgainIfSomebodyIsHere(browserId, loopId);
        // Whether the loop is busy is the one thing a view that just opened cannot wait for an
        // event to tell it: the loop may have been running long before it got here.
        this.sendEvent(client, {
            eventType: 'busy', loopId, content: '', busy: LoopGateway.isLoopBusy(loopId)
        });
        // A question asked while nobody watched this loop was only toasted, and a toast is not
        // something to answer. It is handed over now, which is what the toast sent them here for.
        const pending = this.pendingQuestion(browserId, loopId);
        if (pending) {
            this.sendEvent(client, pending);
        }
    }

    /**
     * A run that asked something and was left with silence stopped asking. Opening the loop is the
     * user saying they are here, so it is worth asking them again. It is worth it for a browser the
     * run never asked as well, as long as the one it did ask is gone: nobody else will answer.
     */
    private static askAgainIfSomebodyIsHere(browserId: string, loopId: string): void {
        const asked = LoopGateway.askedBrowser(loopId);
        if (asked && (asked === browserId || !this.clients.has(asked))) {
            LoopGateway.askAgain(loopId);
        }
    }

    /**
     * The question this browser is owed. One asked of a browser that is gone is put to this one
     * instead, since a tab takes its name with it when it closes and would otherwise leave the run
     * waiting out its ten minutes with a user sitting right there.
     */
    private static pendingQuestion(browserId: string, loopId: string): AgentInteractionEvent | undefined {
        const own = LoopGateway.pendingInteraction(browserId, loopId);
        if (own) {
            return own;
        }
        return this.orphanQuestions().some(question => question.loopId === loopId)
            ? LoopGateway.askAgainOf(browserId, loopId)
            : undefined;
    }

    /** The questions whose browser is not here to answer them. */
    private static orphanQuestions(): AgentInteractionEvent[] {
        return LoopGateway.waitingQuestions().filter(question => !this.clients.has(question.browserId));
    }

    private static broadcastEvent(event: SSEEvent): void {
        const clients = Array.from(this.clients.values()).filter(client => this.shouldSend(client, event));
        for (const client of clients) {
            this.sendEvent(client, event);
        }
        if (isLoopInteractionEvent(event) && !clients.length) {
            this.handleUnwatchedInteraction(event);
        }
    }

    /**
     * Nobody has this loop on screen, so the question is only announced: it stays waiting in the
     * gateway and is handed over as soon as a view of that loop opens. A browser between two
     * connections has nowhere to be announced to, and the question waits for it in silence rather
     * than being dropped, since a reload comes back as the same browser. Waiting ends where the
     * gateway ends it, ten minutes on.
     */
    private static handleUnwatchedInteraction(event: AgentInteractionEvent) {
        if (this.clients.has(event.browserId)) {
            this.sendToast({key: 'interactionPause', data: event.loopId}, event.browserId);
        }
    }

    private static shouldSend(client: SSEClient, event: SSEEvent): boolean {
        if (isInfoEvent(event)) {
            return true;
        }
        if (!('loopId' in event) || !client.loops.has(event.loopId)) {
            return false;
        }
        // What became of the loop itself goes to everyone watching it, whoever asked for it: a tab
        // still showing a conversation that was closed would write into a record of two.
        if (isLoopBusyEvent(event) || isLoopTokenUsageEvent(event) || isLoopSessionResetEvent(event)) {
            return true;
        } else if (isLoopChatEvent(event)) {
            return 'browserId' in event && client.browserId !== event.browserId;
        } else if (isLoopStreamEvent(event) || isLoopInteractionEvent(event)
            || isLoopCancelInteractionEvent(event)) {
            return 'browserId' in event && client.browserId === event.browserId;
        }
        return false;
    }

    private static sendEvent(client: SSEClient, event: SSEEvent): void {
        const message = `event: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
        try {
            client.controller.enqueue(client.encoder.encode(message));
        } catch (err) {
            // A stream nobody can write to is dropped, and that is all: the questions it was
            // watching over keep waiting for the browser to come back and be handed them again.
            this.removeClient(client.browserId, client.streamId);
            this.logger.error(`Failed to send to client ${client.browserId}: ${err}`);
        }
    }

    public static sendToast(content: SSEToastEvent['content'], browserId: string = ''): void {
        const clients = browserId ? [this.clients.get(browserId)]
            : Array.from(this.clients.values());
        for (const client of clients) {
            if (client) {
                this.sendEvent(client, {
                    eventType: 'toast', content
                } as SSEToastEvent);
            }
        }
    }

    /**
     * Only the stream is dropped. The run behind it keeps going, and a question it left waiting is
     * still owed an answer: the page that comes back is the same browser and is handed it again.
     * Which stream ended has to be said, because a reload can open the new one before the old one
     * is noticed to be gone, and dropping the browser by name would take the page that is here now.
     */
    public static removeClient(browserId: string, streamId: number): void {
        if (this.clients.get(browserId)?.streamId !== streamId) {
            return;
        }
        this.clients.delete(browserId);
        if (this.clients.size === 0) {
            this.unsubscriber?.();
            this.unsubscriber = undefined;
        }
    }
}

export const SSEServer = globalize('SSEServer', SSEServerImpl);
