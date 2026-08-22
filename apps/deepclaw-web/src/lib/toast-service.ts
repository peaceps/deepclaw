import type { SSEToastEvent } from "@/app/api/sse-types";
import { AgentEmployee, INTERACTION_TIMEOUT, Project, splitLoopId } from "@deepclaw/core";
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
     * wanted.
     *
     * The way back is the chat of the loop that asked, which is only ever a click away where the
     * page that holds it can be named: an agent nobody knows or a project already gone leave the
     * toast to be read alone, since a link to a page with no chat on it is a click that does
     * nothing.
     */
    public static parseToastEvent(
        content: SSEToastEvent['content'], projects: Project[], agents: AgentEmployee[]
    ): ParsedToast {
        const res: ParsedToast = {
            title: '',
            message: ''
        };
        if (content.key === 'interactionPause') {
            res.duration = INTERACTION_TIMEOUT;
            const loopId = content.data as string;
            const {projectId, agentId} = splitLoopId(loopId);
            let name = agentId;
            let role = 'agent';
            if (projectId) {
                const project = projects.find(p => p.id === projectId);
                if (project) {
                    role = 'project';
                    name = project.title;
                    res.link = {loopId, href: `/projects?project=${encodeURIComponent(project.id)}`};
                }
            } else {
                const agent = agents.find(a => a.id === agentId);
                if (agent) {
                    name = agent.name;
                    res.link = {loopId, href: '/agents'};
                }
            }
            res.title = i18nInstance.t('web.toast.interactionPause.title');
            res.message = i18nInstance.t('web.toast.interactionPause.message', {name, role: i18nInstance.t(`web.toast.interactionPause.role.${role}`)});
        } else {
            res.title = i18nInstance.t(`web.toast.${content.key}.title`);
            res.message = i18nInstance.t(`web.toast.${content.key}.message`, {data: content.data});
        }
        return res;
    }

}
