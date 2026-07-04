import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions";
import type { ToolUseDef } from "../../definitions/tool-definitions";

HookManager.onVisitor('preEachToolUse', (oneLoopContext: OneLoopContext, toolUseDef?: ToolUseDef) => {
    oneLoopContext.actions.addFootPrint({
        type: 'toolUse',
        content: `${toolUseDef?.name} with input ${JSON.stringify(toolUseDef?.input)}`,
    });
});
