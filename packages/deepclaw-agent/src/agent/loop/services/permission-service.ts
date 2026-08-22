import { i18nInstance } from "@deepclaw/i18n";
import { ToolGuardResult } from "../../definitions/tool-definitions";
import { PermissionGroup, PermissionWhiteList } from "../../definitions/definitions";

export class PermissionService {

    /**
     * The list is the one of the conversation the guard was called in, and a group let through is
     * let through for as long as the loop that holds the list stands (see PermissionWhiteList).
     * Whether there is anybody to hear the question is not asked here: the service that carries it
     * to the user answers that.
     */
    public static askPermissionGuard(
        reason: string, group: PermissionGroup, permissionWhiteList: PermissionWhiteList
    ): ToolGuardResult {
        if (permissionWhiteList.has(group)) {
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
                return this.checkAnswer(answer, group, permissionWhiteList);
            }
        }
    }

    private static checkAnswer(
        answer: string, group: PermissionGroup, permissionWhiteList: PermissionWhiteList
    ): boolean {
        answer = answer.trim().toLowerCase();
        if (answer === 'y') {
            return true;
        } else if (answer === 'a') {
            permissionWhiteList.add(group);
            return true;
        } else {
            return false;
        }
    }

}
