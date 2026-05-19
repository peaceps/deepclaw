import { HookManager } from "../services/hook-manager";
import type { OneLoopContext } from "../../definitions/definitions.js";

HookManager.onVisitor('postTurnEnd', (oneLoopContext: OneLoopContext) => {
    oneLoopContext.todoManager.onTurnFinished();
});