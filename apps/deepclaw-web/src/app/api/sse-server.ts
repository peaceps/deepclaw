import {
    isInfoEvent, isLoopBusyEvent, isLoopCancelInteractionEvent,
    isLoopChatEvent, isLoopInteractionEvent, isLoopStreamEvent,
    LoopGateway, LoopGatewayEvent,
    isLoopTokenUsageEvent, isLoopSessionResetEvent,
    type AgentLoopBusyEvent,
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
     * Which loops a browser shows, told by the view that opened or left. What happens in a loop
     * nobody looks at is news sent for nothing. The answer this browser is waiting for is the one
     * exception, and it keeps arriving: see shouldSend.
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
        if (isLoopBusyEvent(event)) {
            this.handleRunEnd(event);
        }
    }

    /**
     * A run ended, and the answer is sitting in a conversation the one waiting on it does not have
     * open: a toast says it is there and is the way to it, the same click that takes them back to a
     * waiting question.
     *
     * Whether they are looking is asked of that browser alone, not of the app: a question needs
     * anybody at all to answer it, so any tab showing the loop is enough, but an answer is owed to
     * whoever asked for it, and another tab holding the conversation open is not them seeing it.
     *
     * Only a run some browser asked for: one from IM was answered where it was asked, and a run
     * with no browser behind it has nobody here waiting on it either way. Nothing of this is kept
     * for a browser that turns up afterwards, unlike a question, which is still going begging when
     * it is handed over: the answer has been written down and is read wherever the chat is opened.
     */
    private static handleRunEnd(event: AgentLoopBusyEvent): void {
        if (event.busy || !event.endedFor) {
            return;
        }
        // Whoever asked, or everybody if that tab is gone: a browser id dies with its tab, and the
        // user who pressed send is then whoever is here now.
        const asked = this.clients.get(event.endedFor);
        const told = asked ? [asked] : [...this.clients.values()];
        told.filter(client => !client.loops.has(event.loopId)).forEach(client =>
            this.sendToast({key: 'runEnded', data: event.loopId}, client.browserId));
    }

    /**
     * Nobody has this loop on screen, so the question is announced rather than shown: it keeps
     * waiting in the gateway and is handed over when a view of it opens. Whose question it is
     * decides who hears of it, and waiting ends where the gateway ends it, ten minutes on.
     */
    private static handleUnwatchedInteraction(event: AgentInteractionEvent) {
        // Still that browser's question, looking elsewhere being no reason to take it away, and the
        // toast is what sends it back to the loop to answer.
        if (this.clients.has(event.browserId)) {
            this.sendToast({key: 'interactionPause', data: event.loopId}, event.browserId);
            return;
        }
        this.offerOrphanQuestion(event);
    }

    /**
     * The browser the question was asked of has no stream at all: its tab is gone, or reloading,
     * and it took its name with it either way. Somebody with that very loop on screen is asked in
     * its place there and then, rather than the next time they open the loop, which a page that
     * already has it open is never going to do again -- left to that, a user sitting in front of
     * the conversation would watch the run wait out its ten minutes with nothing to say there was
     * a question, and be asked only if they happened to leave the page and come back.
     *
     * With nobody watching it is announced to everyone here instead, the way it is to a browser
     * that connects while it waits: silence is the one thing that leaves a run waiting on a user
     * who would have answered. A toast is only the way back to the conversation, so one that turns
     * out by then to belong to a browser that has come back takes nothing from it: whether the
     * question is still going begging is read where it is opened, not where it was announced.
     */
    private static offerOrphanQuestion(event: AgentInteractionEvent): void {
        // Whichever of them has been connected longest, which is the order the streams are held in
        // rather than a choice made between them: any browser with that conversation open is
        // somebody who can answer, and the pick has only to land on one, a question being put to a
        // single browser and answered by that one alone.
        const watcher = [...this.clients.values()].find(client => client.loops.has(event.loopId));
        if (!watcher) {
            this.sendToast({key: 'interactionPause', data: event.loopId});
            return;
        }
        const question = LoopGateway.askAgainOf(watcher.browserId, event.loopId);
        if (question) {
            this.sendEvent(watcher, question);
        }
    }

    private static shouldSend(client: SSEClient, event: SSEEvent): boolean {
        if (isInfoEvent(event)) {
            return true;
        }
        if (!('loopId' in event)) {
            return false;
        }
        // The answer a browser asked for is streamed to it wherever in the app it goes, on screen
        // or not. The chunks live nowhere but the tab, so the ones sent while it was looking at
        // another page are the ones it could never get back: dropped here, the answer it comes back
        // to would be missing its middle, and the end that closes the stream would never arrive.
        if (isLoopStreamEvent(event)) {
            return 'browserId' in event && client.browserId === event.browserId;
        }
        if (!client.loops.has(event.loopId)) {
            return false;
        }
        // What became of the loop itself goes to everyone watching it, whoever asked for it: a tab
        // still showing a conversation that was closed would write into a record of two.
        if (isLoopBusyEvent(event) || isLoopTokenUsageEvent(event) || isLoopSessionResetEvent(event)) {
            return true;
        } else if (isLoopChatEvent(event)) {
            return 'browserId' in event && client.browserId !== event.browserId;
        } else if (isLoopInteractionEvent(event) || isLoopCancelInteractionEvent(event)) {
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
