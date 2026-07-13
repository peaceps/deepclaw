import type { SSEToastEvent } from "@/app/api/sse-types";
import { AgentEmployee, Project, splitLoopId } from "@deepclaw/core";
import {i18nInstance} from '@deepclaw/i18n';

export class ToastService {

    public static parseToastEvent(content: SSEToastEvent['content'], projects: Project[], agents: AgentEmployee[]): {title: string; message: string} {
        const res = {
            title: '',
            message: ''
        };
        if (content.key === 'interactionPause') {
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
        }
        return res;
    }

}
