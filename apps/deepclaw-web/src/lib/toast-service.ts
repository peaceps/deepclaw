import type { SSEToastEvent } from "@/app/api/sse-types";
import { AgentEmployee, INTERACTION_TIMEOUT, SlimProject, splitLoopId } from "@deepclaw/core";
import {i18nInstance} from '@deepclaw/i18n';

/** Where a toast takes the user, once the page it names is known to be there to be opened. */
export type ToastLink = {
    /** The loop whose chat the click asks for, which a page too narrow to show it needs to be told. */
    loopId: string;
    href: string;
}

export type ParsedToast = {title: string; message: string; duration?: number; link?: ToastLink};

export class ToastService {

    /**
     * How long a toast stays is part of what it says: everything here passes soon, except the one
     * that stands for a question waiting to be answered. That one is the only way back to the
     * question, so it stays as long as the question does and goes when the answer is no longer
     * wanted. A run that ended while the user was elsewhere passes: the answer is written down and
     * waiting, so the toast has only to be seen once.
     *
     * The way back is the chat of the loop the toast is about, which is only ever a click away where
     * the page that holds it can be named: an agent nobody knows or a project already gone leave the
     * toast to be read alone, since a link to a page with no chat on it is a click that does
     * nothing.
     */
    public static parseToastEvent(
        content: SSEToastEvent['content'], projects: SlimProject[], agents: AgentEmployee[]
    ): ParsedToast {
        const res: ParsedToast = {
            title: '',
            message: ''
        };
        const key = content.key;
        // A question waiting to be answered is the one toast that has to last, and it is one of the
        // two that carry a loop: those are named and reached through the conversation they are
        // about, where the rest have only what they were sent with to say.
        const waitingQuestion = key === 'interactionPause';
        const aboutAChat = waitingQuestion || key === 'runEnded';
        if (!aboutAChat) {
            res.title = i18nInstance.t(`web.toast.${key}.title`);
            res.message = i18nInstance.t(`web.toast.${key}.message`, {data: content.data});
            return res;
        }
        if (waitingQuestion) {
            res.duration = INTERACTION_TIMEOUT;
        }
        const loopId = content.data as string;
        const {name, role, link} = this.whoseChat(loopId, projects, agents);
        if (link) {
            res.link = link;
        }
        res.title = i18nInstance.t(`web.toast.${key}.title`);
        res.message = i18nInstance.t(`web.toast.${key}.message`, {name, role: i18nInstance.t(`web.toast.${key}.role.${role}`)});
        return res;
    }

    /**
     * The conversation a toast is about, as it is named to the user and as it is reached. An agent
     * nobody knows and a project already gone are named by the agent id alone and left without a
     * link: there is no page holding that chat for a click to open.
     */
    private static whoseChat(
        loopId: string, projects: SlimProject[], agents: AgentEmployee[]
    ): {name: string; role: 'agent' | 'project'; link?: ToastLink} {
        const {projectId, agentId} = splitLoopId(loopId);
        if (projectId) {
            const project = projects.find(p => p.id === projectId);
            return project
                ? {
                    name: project.title, role: 'project',
                    link: {loopId, href: `/projects?project=${encodeURIComponent(project.id)}`}
                }
                : {name: agentId, role: 'agent'};
        }
        const agent = agents.find(a => a.id === agentId);
        return agent
            ? {name: agent.name, role: 'agent', link: {loopId, href: '/agents'}}
            : {name: agentId, role: 'agent'};
    }

}
