import { i18nInstance } from "@deepclaw/i18n";
import { ToolGuardResult } from "../../definitions/tool-definitions";

type PermissionGroup = 'command' | 'file';

export class PermissionService {
    private static allowList: Partial<Record<PermissionGroup, Set<string>>> = {};

    public static askPermissionGuard(reason: string, group: PermissionGroup, loopId: string): ToolGuardResult {
        if (this.permissionGranted(group, loopId)) {
            return {result: 'allowed'};
        }
        return {
            result: 'ask',
            question: {
                type: 'select',
                content: `${reason}${i18nInstance.t('agent.tools.permission.request')}`,
                options: [
                    { label: i18nInstance.t('agent.tools.permission.allowOnce'), value: 'y' },
                    { label: i18nInstance.t(
                        'agent.tools.permission.always',
                        {group: i18nInstance.t(`agent.tools.permission.group.${group}`)}
                    ), value: 'a' },
                    { label: i18nInstance.t('agent.tools.permission.deny'), value: 'n' }
                ]
            },
            checkAnswer: (answer: string) => {
                return this.checkAnswer(answer, group, loopId);
            }
        }
    }

    private static checkAnswer(answer: string, group: PermissionGroup, loopId: string): boolean {
        answer = answer.trim().toLowerCase();
        if (answer === 'y') {
            return true;
        } else if (answer === 'a') {
            if (!this.allowList[group]) {
                this.allowList[group] = new Set<string>();
            }
            this.allowList[group].add(loopId);
            return true;
        } else {
            return false;
        }
    }

    private static permissionGranted(group: PermissionGroup, loopId: string): boolean {
        if (!this.allowList[group]) {
            return false;
        }
        return this.allowList[group].has(loopId);
    }

}
