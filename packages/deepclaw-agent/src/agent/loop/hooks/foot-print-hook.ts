import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions.js";
import type { ToolUseDef } from "../services/tool-use-service.js";

HookManager.onVisitor('preEachToolUse', (oneLoopContext: OneLoopContext, toolUseDef?: ToolUseDef) => {
    oneLoopContext.actions.addFootPrint({
        type: 'toolUse',
        content: `${toolUseDef?.name} with input ${JSON.stringify(toolUseDef?.input)}`,
    });
});
