import type { SSEToastEvent } from "@/app/api/sse-types";
import { AgentEmployee, INTERACTION_TIMEOUT, Project, splitLoopId } from "@deepclaw/core";
import {i18nInstance} from '@deepclaw/i18n';

export class ToastService {

    /**
     * How long a toast stays is part of what it says: everything here passes soon, except the one
     * that stands for a question waiting to be answered. That one is the only way back to the
     * question, so it stays as long as the question does and goes when the answer is no longer
     * wanted.
     */
    public static parseToastEvent(
        content: SSEToastEvent['content'], projects: Project[], agents: AgentEmployee[]
    ): {title: string; message: string; duration?: number} {
        const res: {title: string; message: string; duration?: number} = {
            title: '',
            message: ''
        };
        if (content.key === 'interactionPause') {
            res.duration = INTERACTION_TIMEOUT;
            const {projectId, agentId} = splitLoopId(content.data as string);
            let name = agentId;
            let role = 'agent';
            if (projectId) {
                const project = projects.find(p => p.id === projectId);
                if (project) {
                    role = 'project';
                    name = project.title;
                }
            } else {
                const agent = agents.find(a => a.id === agentId);
                if (agent) {
                    name = agent.name;
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
